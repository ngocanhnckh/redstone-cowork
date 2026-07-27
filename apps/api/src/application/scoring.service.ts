import { Inject, Injectable } from "@nestjs/common";
import {
  ScoringProjectConfigSchema,
  AGENT_WEEK_WEIGHTS,
  type Account,
  type ScoringProjectConfig,
  type ScoringProjectConfigPatch,
  type ScoringTargets,
  type ScoringBoard,
  type ScoringLeaderEntry,
  type MyScore,
  type CriticalProgress,
  type CriticalItem,
  type ScoreHistory,
  type ScoreHistoryPoint,
  type AgentWeekAward,
} from "@rcw/shared";
import { ACCOUNT_STORE, type AccountStore } from "../domain/accounts/account-store.port";
import { SCORING_STORE, type ScoringStore, type PenaltyRecord } from "../domain/scoring/scoring-store.port";
import { JiraService } from "./jira.service";
import { AccountsService } from "./accounts.service";
import { SettingsService } from "./settings.service";
import { weekKeyOf, weekWindow } from "./scoring/week";

const round2 = (n: number) => Math.round(n * 100) / 100;
const AOW_TZ = "Asia/Ho_Chi_Minh"; // the org-wide Agent-of-the-Week reference week
const HISTORY_WEEKS = 8;

/** A penalty ledger row enriched with the agent's display name (admin view). */
export type ScoringPenaltyView = Omit<PenaltyRecord, "dedupeKey"> & { displayName: string };

/**
 * The scoring read/admin service: per-project effort leaderboards, an agent's own standing +
 * history, admin config/targets/critical-tasks, the voidable penalty ledger, and the roster-wide
 * Agent-of-the-Week award (effort blended with token spend). The changelog scanner
 * (JiraScannerService) writes the ledgers; this service only reads + configures.
 */
@Injectable()
export class ScoringService {
  constructor(
    @Inject(SCORING_STORE) private readonly store: ScoringStore,
    @Inject(ACCOUNT_STORE) private readonly accounts: AccountStore,
    private readonly jira: JiraService,
    private readonly accountsSvc: AccountsService,
    private readonly settings: SettingsService,
  ) {}

  // ---- config ----------------------------------------------------------
  async getConfig(projectKey: string): Promise<ScoringProjectConfig> {
    return (await this.store.getConfig(projectKey)) ?? ScoringProjectConfigSchema.parse({ projectKey });
  }
  async listConfigs(): Promise<ScoringProjectConfig[]> {
    return this.store.listConfigs();
  }
  async upsertConfig(projectKey: string, patch: ScoringProjectConfigPatch, adminId: string | null): Promise<ScoringProjectConfig> {
    const merged = ScoringProjectConfigSchema.parse({ ...(await this.getConfig(projectKey)), ...patch, projectKey });
    return this.store.upsertConfig(merged, adminId);
  }

  // ---- targets ---------------------------------------------------------
  async setTargets(t: ScoringTargets): Promise<ScoringTargets> {
    return this.store.upsertTargets(t);
  }

  // ---- critical tasks --------------------------------------------------
  async getCritical(projectKey: string, weekKey: string): Promise<CriticalProgress> {
    const recs = await this.store.getCritical(projectKey, weekKey);
    if (recs.length === 0) return { done: 0, total: 0, items: [] };
    const cfg = await this.getConfig(projectKey);
    const completeSet = await this.resolveCompleteSet(cfg);
    const live = await this.jira.issueStatuses(recs.map((r) => r.issueKey)).catch(() => []);
    const byKey = new Map(live.map((s) => [s.key, s]));
    const items: CriticalItem[] = recs.map((r) => {
      const s = byKey.get(r.issueKey);
      const status = s?.status ?? "";
      const done = s ? (s.statusCategoryKey === "done" || completeSet.has(status)) : false;
      return { issueKey: r.issueKey, summary: s?.summary || r.summary, status, statusCategory: s?.statusCategoryKey ?? "", done };
    });
    return { done: items.filter((i) => i.done).length, total: items.length, items };
  }
  async setCritical(projectKey: string, weekKey: string, issueKeys: string[], adminId: string | null): Promise<CriticalProgress> {
    const uniq = [...new Set(issueKeys.map((k) => k.trim()).filter(Boolean))];
    const live = uniq.length ? await this.jira.issueStatuses(uniq).catch(() => []) : [];
    const summaryOf = new Map(live.map((s) => [s.key, s.summary]));
    await this.store.setCritical(projectKey, weekKey, uniq.map((k) => ({ issueKey: k, summary: summaryOf.get(k) ?? "" })), adminId);
    return this.getCritical(projectKey, weekKey);
  }

  // ---- boards ----------------------------------------------------------
  async board(projectKey: string, weekKeyIn?: string): Promise<ScoringBoard> {
    const cfg = await this.getConfig(projectKey);
    const weekKey = weekKeyIn || weekKeyOf(new Date(), cfg.weekTimezone);
    const window = weekWindow(weekKey, cfg.weekTimezone);
    const [completions, penalties, targets, critical, accounts] = await Promise.all([
      this.store.completionsForWeek(projectKey, weekKey),
      this.store.penaltiesForWeek(projectKey, weekKey),
      this.store.getTargets(projectKey, weekKey),
      this.getCritical(projectKey, weekKey),
      this.accounts.list(),
    ]);
    const acctById = new Map(accounts.map((a) => [a.id, a]));

    type Agg = { accountId: string | null; jiraUser: string; completedHours: number; penaltyHours: number; completions: number; penalties: number };
    const groups = new Map<string, Agg>();
    const keyOf = (accountId: string | null, jiraUser: string) => accountId ?? `jira:${jiraUser}`;
    for (const c of completions) {
      const k = keyOf(c.accountId, c.jiraUser);
      const g = groups.get(k) ?? { accountId: c.accountId, jiraUser: c.jiraUser, completedHours: 0, penaltyHours: 0, completions: 0, penalties: 0 };
      g.completedHours += c.estimateHours; g.completions += 1;
      groups.set(k, g);
    }
    for (const p of penalties) {
      const k = keyOf(p.accountId, p.jiraUser);
      const g = groups.get(k) ?? { accountId: p.accountId, jiraUser: p.jiraUser, completedHours: 0, penaltyHours: 0, completions: 0, penalties: 0 };
      g.penaltyHours += Math.abs(p.points); g.penalties += 1;
      groups.set(k, g);
    }

    const entries: ScoringLeaderEntry[] = [...groups.values()]
      .map((g) => {
        const a = g.accountId ? acctById.get(g.accountId) : undefined;
        return {
          accountId: g.accountId, jiraUser: g.jiraUser,
          displayName: a?.displayName || a?.username || g.jiraUser || "Unknown",
          photo: a?.photo ?? null,
          completedHours: round2(g.completedHours), penaltyHours: round2(g.penaltyHours),
          score: round2(g.completedHours - g.penaltyHours),
          completions: g.completions, penalties: g.penalties, rank: 0,
        };
      })
      .sort((x, y) => y.score - x.score || y.completedHours - x.completedHours)
      .map((e, i) => ({ ...e, rank: i + 1 }));

    const teamScore = round2(entries.reduce((s, e) => s + e.score, 0));
    return {
      projectKey, weekKey,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
      timezone: cfg.weekTimezone,
      teamScore,
      teamTarget: targets?.teamTarget ?? cfg.defaultTeamTarget,
      individualTarget: targets?.individualTarget ?? cfg.defaultIndividualTarget,
      entries, critical,
    };
  }

  /** The logged-in agent's own standing on a project team (right-rail widget source). */
  async myScore(account: Account, projectKeyIn?: string): Promise<MyScore | null> {
    const projectKey = projectKeyIn || (await this.pickProjectFor(account));
    if (!projectKey) return null;
    const board = await this.board(projectKey);
    const mine = board.entries.find((e) => e.accountId === account.id) ?? null;
    return {
      projectKey, weekKey: board.weekKey,
      myScore: mine?.score ?? 0,
      completedHours: mine?.completedHours ?? 0,
      penaltyHours: mine?.penaltyHours ?? 0,
      individualTarget: board.individualTarget,
      rank: mine?.rank ?? 0,
      teamMembers: board.entries.length,
      teamScore: board.teamScore,
      teamTarget: board.teamTarget,
      critical: board.critical,
    };
  }

  /** An agent's per-week score trend for a project (last N weeks, derived from the ledgers). */
  async history(account: Account, projectKeyIn?: string, weeks = HISTORY_WEEKS): Promise<ScoreHistory> {
    const projectKey = projectKeyIn || (await this.pickProjectFor(account));
    if (!projectKey) return { projectKey: projectKeyIn || "", points: [] };
    const cfg = await this.getConfig(projectKey);
    const [completions, penalties] = await Promise.all([
      this.store.completionsForAccount(account.id, projectKey),
      this.store.penaltiesForAccount(account.id, projectKey),
    ]);
    const byWeek = new Map<string, { c: number; p: number }>();
    for (const c of completions) {
      const w = byWeek.get(c.weekKey) ?? { c: 0, p: 0 }; w.c += c.estimateHours; byWeek.set(c.weekKey, w);
    }
    for (const p of penalties) {
      const w = byWeek.get(p.weekKey) ?? { c: 0, p: 0 }; w.p += Math.abs(p.points); byWeek.set(p.weekKey, w);
    }
    // The last `weeks` week keys up to and including the current one (fill gaps with zero).
    const keys = recentWeekKeys(cfg.weekTimezone, weeks);
    const points: ScoreHistoryPoint[] = keys.map((weekKey) => {
      const w = byWeek.get(weekKey) ?? { c: 0, p: 0 };
      return { weekKey, completedHours: round2(w.c), penaltyHours: round2(w.p), score: round2(w.c - w.p) };
    });
    return { projectKey, points };
  }

  // ---- penalties -------------------------------------------------------
  async listPenalties(projectKey: string, includeVoided: boolean): Promise<ScoringPenaltyView[]> {
    const [rows, accounts] = await Promise.all([this.store.listPenalties(projectKey, { includeVoided }), this.accounts.list()]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return rows.map(({ dedupeKey: _d, ...r }) => ({ ...r, displayName: (r.accountId && byId.get(r.accountId)?.displayName) || r.jiraUser || "Unknown" }));
  }
  async voidPenalty(id: string, adminId: string): Promise<boolean> {
    return !!(await this.store.voidPenalty(id, adminId, new Date()));
  }

  // ---- project list + picker source -----------------------------------
  async projects(): Promise<Array<{ projectKey: string; enabled: boolean }>> {
    return (await this.store.listConfigs()).map((c) => ({ projectKey: c.projectKey, enabled: c.enabled }));
  }
  async sprintIssues(projectKey: string) {
    return this.jira.projectSprintIssues(projectKey);
  }
  /** All Jira projects visible under the default profile — the admin's "add project" picker. */
  async jiraProjects(): Promise<Array<{ key: string; name: string }>> {
    const profile = await this.jira.defaultProfile();
    if (!profile) return [];
    try { return await this.jira.listProjects(profile); } catch { return []; }
  }

  // ---- Agent of the Week (effort blended with token spend) -------------
  async agentWeekAward(now = new Date()): Promise<AgentWeekAward> {
    const weekKey = weekKeyOf(now, AOW_TZ);
    const win = weekWindow(weekKey, AOW_TZ);
    const [roster, configs, tokenMap, prize] = await Promise.all([
      this.accounts.list().then((l) => l.filter((a) => !a.disabledAt)),
      this.store.listConfigs().then((cs) => cs.filter((c) => c.enabled)),
      this.accountsSvc.tokensSince(win.start, win.end),
      this.prizeText(),
    ]);

    const effortByAccount = new Map<string, number>();
    for (const cfg of configs) {
      for (const a of roster) {
        const [comps, pens] = await Promise.all([
          this.store.completionsForAccount(a.id, cfg.projectKey),
          this.store.penaltiesForAccount(a.id, cfg.projectKey),
        ]);
        const c = comps.filter((x) => x.weekKey === weekKey).reduce((s, x) => s + x.estimateHours, 0);
        const p = pens.filter((x) => x.weekKey === weekKey).reduce((s, x) => s + Math.abs(x.points), 0);
        if (c || p) effortByAccount.set(a.id, (effortByAccount.get(a.id) ?? 0) + (c - p));
      }
    }

    const rows = roster.map((a) => ({
      accountId: a.id, displayName: a.displayName || a.username, username: a.username,
      photo: a.photo ?? null, division: a.division ?? "", jira: a.jira ?? "",
      effortScore: round2(Math.max(0, effortByAccount.get(a.id) ?? 0)), tokens: tokenMap.get(a.id) ?? 0,
    }));
    const maxE = Math.max(1, ...rows.map((r) => r.effortScore));
    const maxT = Math.max(1, ...rows.map((r) => r.tokens));
    const entries = rows
      .map((r) => ({
        ...r,
        score: round2(100 * (AGENT_WEEK_WEIGHTS.effort * (r.effortScore / maxE) + AGENT_WEEK_WEIGHTS.tokens * (r.tokens / maxT))),
        rank: 0,
      }))
      .sort((a, b) => b.score - a.score || b.effortScore - a.effortScore)
      .map((e, i) => ({ ...e, rank: i + 1 }));

    return { prize, window: { start: win.start.toISOString(), end: win.end.toISOString() }, weights: { ...AGENT_WEEK_WEIGHTS }, entries };
  }

  // ---- helpers ---------------------------------------------------------
  private async resolveCompleteSet(cfg: ScoringProjectConfig): Promise<Set<string>> {
    return cfg.completeStatuses.length ? new Set(cfg.completeStatuses) : new Set(await this.jira.projectDoneStatuses(cfg.projectKey).catch(() => []));
  }
  /** The project whose board an agent should see: where they have completions, else the first enabled. */
  private async pickProjectFor(account: Account): Promise<string | null> {
    const configs = (await this.store.listConfigs()).filter((c) => c.enabled);
    if (configs.length === 0) return null;
    for (const c of configs) {
      if ((await this.store.completionsForAccount(account.id, c.projectKey)).length > 0) return c.projectKey;
    }
    return configs[0].projectKey;
  }
  private async prizeText(): Promise<string> {
    try {
      const raw = await this.settings.get("agency:week:config");
      return raw ? String((JSON.parse(raw) as { prize?: string }).prize ?? "") : "";
    } catch { return ""; }
  }
}

/** The last `weeks` Monday keys (in tz), oldest → newest, ending with the current week. */
function recentWeekKeys(timeZone: string, weeks: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) out.push(weekKeyOf(new Date(now.getTime() - i * 7 * 24 * 3600_000), timeZone));
  return [...new Set(out)];
}
