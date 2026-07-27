import { describe, it, expect } from "vitest";
import {
  ScoringProjectConfigSchema,
  ScoringProjectConfigPatchSchema,
  ScoringPenaltySchema,
  ScoringTargetsSchema,
} from "../src/scoring/scoring";

describe("scoring schemas", () => {
  it("applies config defaults for a bare project key", () => {
    const c = ScoringProjectConfigSchema.parse({ projectKey: "JP" });
    expect(c).toMatchObject({
      completeStatuses: [],
      reopenPenaltyPct: 30,
      followupPenaltyPct: 30,
      weekTimezone: "Asia/Ho_Chi_Minh",
      enabled: true,
    });
  });

  it("rejects out-of-range penalty percentages", () => {
    expect(() => ScoringProjectConfigSchema.parse({ projectKey: "JP", reopenPenaltyPct: 140 })).toThrow();
    expect(ScoringProjectConfigPatchSchema.parse({ followupPenaltyPct: 0 }).followupPenaltyPct).toBe(0);
  });

  it("round-trips a penalty row (coerces the ISO timestamps)", () => {
    const p = ScoringPenaltySchema.parse({
      id: "p1", projectKey: "JP", issueKey: "JP-1", accountId: null, jiraUser: "cuong.vu",
      type: "reopen", taskEstimateHours: 8, penaltyPct: 30, points: -2.4, detail: "",
      occurredAt: "2026-07-24T17:31:00.000Z", weekKey: "2026-07-20",
      voided: false, voidedBy: null, voidedAt: null, detectedAt: "2026-07-25T00:00:00.000Z",
    });
    expect(p.occurredAt).toBeInstanceOf(Date);
    expect(p.points).toBe(-2.4);
  });

  it("defaults targets to zero", () => {
    const t = ScoringTargetsSchema.parse({ projectKey: "JP", weekKey: "2026-07-20" });
    expect(t).toEqual({ projectKey: "JP", weekKey: "2026-07-20", teamTarget: 0, individualTarget: 0 });
  });
});
