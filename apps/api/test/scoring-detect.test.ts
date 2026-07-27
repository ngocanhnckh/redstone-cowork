import { describe, it, expect } from "vitest";
import {
  estimateHours, firstCompletion, reopenEvents, followupLinks,
  type ChangeHistory,
} from "../src/application/scoring/detect";

const COMPLETE = new Set(["Done", "Closed"]);
const h = (id: string, created: string, from: string | null, to: string | null, author = "u"): ChangeHistory => ({
  id, created, author, items: [{ field: "status", fromString: from, toString: to }],
});

describe("estimateHours", () => {
  it("converts seconds → hours, null/zero → 0", () => {
    expect(estimateHours(3600)).toBe(1);
    expect(estimateHours(28800)).toBe(8);
    expect(estimateHours(5400)).toBe(1.5);
    expect(estimateHours(null)).toBe(0);
    expect(estimateHours(0)).toBe(0);
    expect(estimateHours(undefined)).toBe(0);
  });
});

describe("firstCompletion", () => {
  it("finds the first entry into a complete status (ignores later ones)", () => {
    const hist = [
      h("1", "2026-07-27T09:00:00Z", "To Do", "In Progress"),
      h("2", "2026-07-28T10:00:00Z", "In Progress", "Done"),
      h("3", "2026-07-29T11:00:00Z", "Done", "Closed"),
    ];
    const fc = firstCompletion(hist, COMPLETE);
    expect(fc?.status).toBe("Done");
    expect(fc?.historyId).toBe("2");
    expect(fc?.at.toISOString()).toBe("2026-07-28T10:00:00.000Z");
  });

  it("orders unsorted histories and returns null if never completed", () => {
    const hist = [h("2", "2026-07-28T10:00:00Z", "In Progress", "In Review"), h("1", "2026-07-27T09:00:00Z", "To Do", "In Progress")];
    expect(firstCompletion(hist, COMPLETE)).toBeNull();
  });
});

describe("reopenEvents", () => {
  it("captures every complete→non-complete transition", () => {
    const hist = [
      h("1", "2026-07-28T10:00:00Z", "In Progress", "Done"),
      h("2", "2026-07-29T10:00:00Z", "Done", "In Progress"),   // reopen 1
      h("3", "2026-07-30T10:00:00Z", "In Progress", "Done"),
      h("4", "2026-07-31T10:00:00Z", "Done", "Reopened"),      // reopen 2
    ];
    const re = reopenEvents(hist, COMPLETE);
    expect(re.map((r) => r.historyId)).toEqual(["2", "4"]);
    expect(re[0].to).toBe("In Progress");
  });

  it("does not count complete→complete (e.g. Done→Closed) as a reopen", () => {
    const hist = [h("1", "2026-07-28T10:00:00Z", "In Progress", "Done"), h("2", "2026-07-29T10:00:00Z", "Done", "Closed")];
    expect(reopenEvents(hist, COMPLETE)).toEqual([]);
  });
});

describe("followupLinks", () => {
  const completedAt = new Date("2026-07-28T10:00:00Z");
  it("returns only links to issues created strictly after completion", () => {
    const links = [
      { typeName: "Relates", key: "JP-1", created: "2026-07-20T00:00:00Z" }, // before → ignored
      { typeName: "Blocks", key: "JP-2", created: "2026-07-29T00:00:00Z" },   // after → follow-up
      { typeName: "Causes", key: "JP-3", created: null },                     // unknown → ignored
    ];
    const f = followupLinks(links, completedAt);
    expect(f.map((x) => x.key)).toEqual(["JP-2"]);
  });
});
