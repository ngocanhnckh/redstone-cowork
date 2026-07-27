import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryScoringStore } from "../src/adapters/persistence/in-memory-scoring-store";
import type { CompletionRecord, PenaltyRecord } from "../src/domain/scoring/scoring-store.port";

const completion = (over: Partial<CompletionRecord> = {}): CompletionRecord => ({
  issueKey: "JP-1", projectKey: "JP", accountId: "a1", jiraUser: "cuong.vu",
  estimateHours: 8, completeStatus: "Done", completedAt: new Date("2026-07-28T10:00:00Z"),
  weekKey: "2026-07-27", detectedAt: new Date("2026-07-28T10:05:00Z"), ...over,
});
const penalty = (over: Partial<PenaltyRecord> = {}): PenaltyRecord => ({
  id: "p1", projectKey: "JP", issueKey: "JP-1", accountId: "a1", jiraUser: "cuong.vu",
  type: "reopen", taskEstimateHours: 8, penaltyPct: 30, points: -2.4, detail: "",
  occurredAt: new Date("2026-07-29T10:00:00Z"), weekKey: "2026-07-27", dedupeKey: "JP-1|reopen|h2",
  voided: false, voidedBy: null, voidedAt: null, detectedAt: new Date("2026-07-29T10:05:00Z"), ...over,
});

describe("ScoringStore (in-memory contract)", () => {
  let store: InMemoryScoringStore;
  beforeEach(() => { store = new InMemoryScoringStore(); });

  it("insertCompletionIfAbsent is idempotent on issue_key", async () => {
    expect(await store.insertCompletionIfAbsent(completion())).toBe(true);
    expect(await store.insertCompletionIfAbsent(completion({ estimateHours: 99 }))).toBe(false);
    const week = await store.completionsForWeek("JP", "2026-07-27");
    expect(week).toHaveLength(1);
    expect(week[0].estimateHours).toBe(8); // first write wins
  });

  it("insertPenaltyIfAbsent dedupes on dedupe_key", async () => {
    expect(await store.insertPenaltyIfAbsent(penalty())).toBe(true);
    expect(await store.insertPenaltyIfAbsent(penalty({ id: "p2" }))).toBe(false); // same dedupeKey
    expect(await store.penaltiesForWeek("JP", "2026-07-27")).toHaveLength(1);
  });

  it("voidPenalty flips the flag and drops it from non-voided queries", async () => {
    await store.insertPenaltyIfAbsent(penalty());
    const v = await store.voidPenalty("p1", "admin1", new Date("2026-07-30T00:00:00Z"));
    expect(v?.voided).toBe(true);
    expect(await store.penaltiesForWeek("JP", "2026-07-27")).toHaveLength(0);
    expect(await store.penaltiesForWeek("JP", "2026-07-27", { includeVoided: true })).toHaveLength(1);
  });

  it("scopes queries by week and account", async () => {
    await store.insertCompletionIfAbsent(completion({ issueKey: "JP-1", weekKey: "2026-07-27", accountId: "a1" }));
    await store.insertCompletionIfAbsent(completion({ issueKey: "JP-2", weekKey: "2026-08-03", accountId: "a1" }));
    await store.insertCompletionIfAbsent(completion({ issueKey: "JP-3", weekKey: "2026-07-27", accountId: "a2" }));
    expect(await store.completionsForWeek("JP", "2026-07-27")).toHaveLength(2);
    expect(await store.completionsForAccount("a1", "JP")).toHaveLength(2);
  });

  it("round-trips targets and critical replacement", async () => {
    await store.upsertTargets({ projectKey: "JP", weekKey: "2026-07-27", teamTarget: 40, individualTarget: 8 });
    expect((await store.getTargets("JP", "2026-07-27"))?.teamTarget).toBe(40);
    await store.setCritical("JP", "2026-07-27", [{ issueKey: "JP-9", summary: "SSO" }], "admin1");
    await store.setCritical("JP", "2026-07-27", [{ issueKey: "JP-10", summary: "Billing" }], "admin1"); // replace
    const crit = await store.getCritical("JP", "2026-07-27");
    expect(crit.map((c) => c.issueKey)).toEqual(["JP-10"]);
  });

  it("stores and reads a scan cursor", async () => {
    expect(await store.getCursor("JP")).toBeNull();
    await store.setCursor("JP", new Date("2026-07-28T00:00:00Z"));
    expect((await store.getCursor("JP"))?.toISOString()).toBe("2026-07-28T00:00:00.000Z");
  });
});
