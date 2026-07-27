import { describe, it, expect, beforeEach } from "vitest";
import { ScoringProjectConfigSchema, type Account } from "@rcw/shared";
import { InMemoryScoringStore } from "../src/adapters/persistence/in-memory-scoring-store";
import { JiraScannerService } from "../src/application/scoring/jira-scanner.service";
import type { ScannedIssue } from "../src/adapters/jira/jira-client";
import type { AccountStore } from "../src/domain/accounts/account-store.port";
import type { JiraService } from "../src/application/jira.service";

const acct = (id: string, jira: string): Account => ({
  id, username: jira, displayName: jira, role: "member", photo: null, level: "", division: "",
  email: "", jira, mattermost: "", phone: "", github: "", bio: "", createdAt: new Date(), disabledAt: null,
});

// A scanned JP issue: 8h estimate, completed (In Progress→Done), then reopened (Done→In Progress),
// with a follow-up issue linked that was created after completion.
const issue = (over: Partial<ScannedIssue> = {}): ScannedIssue => ({
  key: "JP-1", projectKey: "JP", estimateSeconds: 28800,
  assignee: { name: "cuong.vu", displayName: "Cuong Vu" },
  status: "In Progress", statusCategoryKey: "indeterminate", resolutionDate: null,
  created: "2026-07-20T00:00:00Z",
  issuelinks: [{ typeName: "Blocks", key: "JP-9", created: "2026-07-30T00:00:00Z" }],
  histories: [
    { id: "1", created: "2026-07-27T09:00:00Z", author: "cuong.vu", items: [{ field: "status", fromString: "To Do", toString: "In Progress" }] },
    { id: "2", created: "2026-07-28T10:00:00Z", author: "cuong.vu", items: [{ field: "status", fromString: "In Progress", toString: "Done" }] },
    { id: "3", created: "2026-07-29T10:00:00Z", author: "cuong.vu", items: [{ field: "status", fromString: "Done", toString: "In Progress" }] },
  ],
  ...over,
});

function fakes(issues: ScannedIssue[], doneStatuses: string[] = ["Done"]) {
  const store = new InMemoryScoringStore();
  const accounts = { findByJiraUsername: async (j: string) => (j === "cuong.vu" ? acct("a1", "cuong.vu") : null) } as unknown as AccountStore;
  const jira = {
    scanProject: async () => issues,
    projectDoneStatuses: async () => doneStatuses,
  } as unknown as JiraService;
  return { store, scanner: new JiraScannerService(store, accounts, jira) };
}

const JP = ScoringProjectConfigSchema.parse({ projectKey: "JP", completeStatuses: ["Done"], reopenPenaltyPct: 30, followupPenaltyPct: 30, weekTimezone: "UTC" });

describe("JiraScannerService.scanProject", () => {
  it("credits one completion and logs a reopen + follow-up penalty", async () => {
    const { store, scanner } = fakes([issue()]);
    const r = await scanner.scanProject(JP, new Date("2026-07-31T00:00:00Z"));
    expect(r).toEqual({ completions: 1, penalties: 2 });

    const comp = await store.completionsForWeek("JP", "2026-07-27");
    expect(comp).toHaveLength(1);
    expect(comp[0]).toMatchObject({ issueKey: "JP-1", accountId: "a1", estimateHours: 8, completeStatus: "Done" });

    const pens = await store.penaltiesForWeek("JP", "2026-07-27");
    expect(pens.map((p) => p.type).sort()).toEqual(["followup", "reopen"]);
    expect(pens.every((p) => p.points === -2.4)).toBe(true); // 30% of 8h
    expect(pens.every((p) => p.accountId === "a1" && p.weekKey === "2026-07-27")).toBe(true);
  });

  it("is idempotent: a second scan of the same data inserts nothing", async () => {
    const { store, scanner } = fakes([issue()]);
    await scanner.scanProject(JP, new Date("2026-07-31T00:00:00Z"));
    const again = await scanner.scanProject(JP, new Date("2026-07-31T01:00:00Z"));
    expect(again).toEqual({ completions: 0, penalties: 0 });
    expect(await store.completionsForWeek("JP", "2026-07-27")).toHaveLength(1);
    expect(await store.penaltiesForWeek("JP", "2026-07-27")).toHaveLength(2);
  });

  it("excludes issues with no estimate", async () => {
    const { store, scanner } = fakes([issue({ estimateSeconds: null })]);
    const r = await scanner.scanProject(JP, new Date("2026-07-31T00:00:00Z"));
    expect(r).toEqual({ completions: 0, penalties: 0 });
    expect(await store.completionsForWeek("JP", "2026-07-27")).toHaveLength(0);
  });

  it("falls back to done-category statuses when none are configured", async () => {
    const cfg = ScoringProjectConfigSchema.parse({ projectKey: "JP", weekTimezone: "UTC" }); // empty completeStatuses
    const { store, scanner } = fakes([issue()], ["Done", "Closed"]);
    const r = await scanner.scanProject(cfg, new Date("2026-07-31T00:00:00Z"));
    expect(r.completions).toBe(1);
    expect(await store.completionsForWeek("JP", "2026-07-27")).toHaveLength(1);
  });
});
