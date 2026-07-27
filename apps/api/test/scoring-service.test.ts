import { describe, it, expect, beforeEach } from "vitest";
import { ScoringProjectConfigSchema, type Account } from "@rcw/shared";
import { InMemoryScoringStore } from "../src/adapters/persistence/in-memory-scoring-store";
import { ScoringService } from "../src/application/scoring.service";
import type { AccountStore } from "../src/domain/accounts/account-store.port";
import type { JiraService } from "../src/application/jira.service";
import type { AccountsService } from "../src/application/accounts.service";
import type { SettingsService } from "../src/application/settings.service";
import type { CompletionRecord, PenaltyRecord } from "../src/domain/scoring/scoring-store.port";

const acct = (id: string, name: string): Account => ({
  id, username: name, displayName: name, role: "member", photo: null, level: "", division: "Eng",
  email: "", jira: name, mattermost: "", phone: "", github: "", bio: "", createdAt: new Date(), disabledAt: null,
});
const W = "2026-07-27";
const comp = (o: Partial<CompletionRecord>): CompletionRecord => ({
  issueKey: "JP-1", projectKey: "JP", accountId: "a1", jiraUser: "cuong", estimateHours: 8,
  completeStatus: "Done", completedAt: new Date("2026-07-28T00:00:00Z"), weekKey: W, detectedAt: new Date(), ...o,
});
const pen = (o: Partial<PenaltyRecord>): PenaltyRecord => ({
  id: "p1", projectKey: "JP", issueKey: "JP-1", accountId: "a1", jiraUser: "cuong", type: "reopen",
  taskEstimateHours: 8, penaltyPct: 30, points: -2.4, detail: "", occurredAt: new Date("2026-07-29T00:00:00Z"),
  weekKey: W, dedupeKey: "JP-1|reopen|x", voided: false, voidedBy: null, voidedAt: null, detectedAt: new Date(), ...o,
});

function make(roster: Account[], jiraStatuses: Array<{ key: string; summary: string; status: string; statusCategoryKey: string }> = []) {
  const store = new InMemoryScoringStore();
  const accounts = { list: async () => roster, findByJiraUsername: async () => null, findById: async (id: string) => roster.find((a) => a.id === id) ?? null } as unknown as AccountStore;
  const jira = { issueStatuses: async () => jiraStatuses, projectDoneStatuses: async () => ["Done"], projectSprintIssues: async () => [] } as unknown as JiraService;
  const accountsSvc = { tokensSince: async () => new Map<string, number>() } as unknown as AccountsService;
  const settings = { get: async () => null } as unknown as SettingsService;
  return { store, svc: new ScoringService(store, accounts, jira, accountsSvc, settings) };
}

describe("ScoringService.board", () => {
  let store: InMemoryScoringStore, svc: ScoringService;
  beforeEach(async () => {
    ({ store, svc } = make([acct("a1", "cuong"), acct("a2", "minh")]));
    await store.upsertConfig(ScoringProjectConfigSchema.parse({ projectKey: "JP", completeStatuses: ["Done"], weekTimezone: "UTC" }), null);
    await store.insertCompletionIfAbsent(comp({ issueKey: "JP-1", accountId: "a1", jiraUser: "cuong", estimateHours: 8 }));
    await store.insertCompletionIfAbsent(comp({ issueKey: "JP-2", accountId: "a2", jiraUser: "minh", estimateHours: 4 }));
    await store.insertPenaltyIfAbsent(pen({ id: "p1", accountId: "a1", jiraUser: "cuong", dedupeKey: "d1" }));
    // A voided penalty on a2 must NOT reduce the score.
    await store.insertPenaltyIfAbsent(pen({ id: "p2", accountId: "a2", jiraUser: "minh", dedupeKey: "d2", voided: true }));
  });

  it("ranks by score = completedHours − non-voided penalties", async () => {
    const board = await svc.board("JP", W);
    expect(board.entries.map((e) => [e.displayName, e.score])).toEqual([["cuong", 5.6], ["minh", 4]]);
    expect(board.entries[0].rank).toBe(1);
    expect(board.teamScore).toBe(9.6);
  });

  it("myScore returns the agent's own standing", async () => {
    const mine = await svc.myScore(acct("a1", "cuong"), "JP");
    expect(mine).toMatchObject({ myScore: 5.6, rank: 1, teamMembers: 2, teamScore: 9.6, projectKey: "JP" });
  });
});

describe("ScoringService.getCritical", () => {
  it("computes done-ness from live Jira status", async () => {
    const { store, svc } = make([acct("a1", "cuong")], [
      { key: "JP-9", summary: "SSO", status: "Done", statusCategoryKey: "done" },
      { key: "JP-10", summary: "Billing", status: "In Progress", statusCategoryKey: "indeterminate" },
    ]);
    await store.upsertConfig(ScoringProjectConfigSchema.parse({ projectKey: "JP", completeStatuses: ["Done"], weekTimezone: "UTC" }), null);
    await svc.setCritical("JP", W, ["JP-9", "JP-10"], "admin1");
    const crit = await svc.getCritical("JP", W);
    expect(crit.total).toBe(2);
    expect(crit.done).toBe(1);
    expect(crit.items.find((i) => i.issueKey === "JP-9")?.done).toBe(true);
  });
});

describe("ScoringService.voidPenalty", () => {
  it("voids and removes from the score", async () => {
    const { store, svc } = make([acct("a1", "cuong")]);
    await store.upsertConfig(ScoringProjectConfigSchema.parse({ projectKey: "JP", completeStatuses: ["Done"], weekTimezone: "UTC" }), null);
    await store.insertCompletionIfAbsent(comp({ issueKey: "JP-1", estimateHours: 8 }));
    await store.insertPenaltyIfAbsent(pen({ id: "p1", dedupeKey: "d1" }));
    expect((await svc.board("JP", W)).entries[0].score).toBe(5.6);
    await svc.voidPenalty("p1", "admin1");
    expect((await svc.board("JP", W)).entries[0].score).toBe(8);
  });
});
