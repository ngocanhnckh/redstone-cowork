import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { ScoringProjectConfig } from "@rcw/shared";
import { ACCOUNT_STORE, type AccountStore } from "../../domain/accounts/account-store.port";
import { SCORING_STORE, type ScoringStore } from "../../domain/scoring/scoring-store.port";
import { JiraService } from "../jira.service";
import { estimateHours, firstCompletion, reopenEvents, followupLinks } from "./detect";
import { weekKeyOf } from "./week";

/** Minutes added to the since-last-run window to absorb Jira `updated`-index lag. */
const OVERLAP_MIN = 15;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Periodically scans each enabled project's recently-updated issues and reconciles the scoring
 * ledgers: credit each issue's first completion, and log reopen / follow-up penalties. Idempotent
 * — `insertCompletionIfAbsent` (PK issue_key) and `insertPenaltyIfAbsent` (unique dedupe_key)
 * make a re-scan of the same data a no-op. Disabled in tests (driven manually via `scanProject`).
 */
@Injectable()
export class JiraScannerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(JiraScannerService.name);
  private timer?: NodeJS.Timeout;
  private fullTimer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(SCORING_STORE) private readonly store: ScoringStore,
    @Inject(ACCOUNT_STORE) private readonly accounts: AccountStore,
    private readonly jira: JiraService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test" || process.env.SCORING_SCAN_DISABLED) return;
    const ms = Number(process.env.SCORING_SCAN_INTERVAL_MS ?? 300_000);
    this.timer = setInterval(() => void this.scanAll().catch((e) => this.log.warn(`scan failed: ${e}`)), ms);
    // A daily FULL rescan (cursor reset) backfills completions whose estimate was added
    // after the issue was already done — the common case while estimation adoption ramps up.
    this.fullTimer = setInterval(() => void this.scanAll(true).catch(() => {}), 24 * 60 * 60_000);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.fullTimer) clearInterval(this.fullTimer);
  }

  /** Scan every enabled project once. `full` forces a from-scratch scan (ignores the cursor). */
  async scanAll(full = false): Promise<void> {
    if (this.running) return; // never overlap scans in one process
    this.running = true;
    try {
      const configs = (await this.store.listConfigs()).filter((c) => c.enabled);
      for (const cfg of configs) {
        try { await this.scanProject(cfg, new Date(), full); }
        catch (e) { this.log.warn(`scan ${cfg.projectKey} failed: ${e}`); }
      }
    } finally {
      this.running = false;
    }
  }

  /** The idempotent reconciliation core for one project (the unit-tested entry point). */
  async scanProject(cfg: ScoringProjectConfig, now = new Date(), full = false): Promise<{ completions: number; penalties: number }> {
    const lastRun = full ? null : await this.store.getCursor(cfg.projectKey);
    const sinceMinutes = lastRun ? (now.getTime() - lastRun.getTime()) / 60_000 + OVERLAP_MIN : null;
    const issues = await this.jira.scanProject(cfg.projectKey, sinceMinutes);

    const completeSet = cfg.completeStatuses.length
      ? new Set(cfg.completeStatuses)
      : new Set(await this.jira.projectDoneStatuses(cfg.projectKey));

    let completions = 0, penalties = 0;
    for (const issue of issues) {
      const est = estimateHours(issue.estimateSeconds);
      if (est === 0) continue; // no estimate → doesn't score

      // When did it first "complete"? Prefer the changelog; fall back to resolutiondate if the
      // issue is currently in a complete status but its completion predates the fetched history.
      const fc = firstCompletion(issue.histories, completeSet);
      let completedAt: Date, completeStatus: string;
      if (fc) { completedAt = fc.at; completeStatus = fc.status; }
      else if (issue.resolutionDate && completeSet.has(issue.status)) { completedAt = new Date(issue.resolutionDate); completeStatus = issue.status; }
      else continue; // never completed

      const jiraUser = issue.assignee?.name ?? "";
      const acct = jiraUser ? await this.accounts.findByJiraUsername(jiraUser) : null;
      const accountId = acct?.id ?? null;
      const weekKey = weekKeyOf(completedAt, cfg.weekTimezone);

      if (await this.store.insertCompletionIfAbsent({
        issueKey: issue.key, projectKey: cfg.projectKey, accountId, jiraUser,
        estimateHours: est, completeStatus, completedAt, weekKey, detectedAt: now,
      })) completions++;

      // Reopens: complete → non-complete transitions (penalty offsets the completion's week).
      for (const r of reopenEvents(issue.histories, completeSet)) {
        if (r.at.getTime() < completedAt.getTime()) continue;
        const points = round2(-(est * cfg.reopenPenaltyPct) / 100);
        if (await this.store.insertPenaltyIfAbsent({
          id: randomUUID(), projectKey: cfg.projectKey, issueKey: issue.key, accountId, jiraUser,
          type: "reopen", taskEstimateHours: est, penaltyPct: cfg.reopenPenaltyPct, points,
          detail: `reopened: ${r.from} → ${r.to}`, occurredAt: r.at, weekKey,
          dedupeKey: `${issue.key}|reopen|${r.historyId}`,
          voided: false, voidedBy: null, voidedAt: null, detectedAt: now,
        })) penalties++;
      }

      // Follow-ups: any issue linked to this one that was created after completion.
      for (const f of followupLinks(issue.issuelinks, completedAt)) {
        const points = round2(-(est * cfg.followupPenaltyPct) / 100);
        if (await this.store.insertPenaltyIfAbsent({
          id: randomUUID(), projectKey: cfg.projectKey, issueKey: issue.key, accountId, jiraUser,
          type: "followup", taskEstimateHours: est, penaltyPct: cfg.followupPenaltyPct, points,
          detail: `follow-up ${f.key} (${f.typeName || "linked"})`, occurredAt: f.created, weekKey,
          dedupeKey: `${issue.key}|followup|${f.key}`,
          voided: false, voidedBy: null, voidedAt: null, detectedAt: now,
        })) penalties++;
      }
    }

    await this.store.setCursor(cfg.projectKey, now);
    return { completions, penalties };
  }
}
