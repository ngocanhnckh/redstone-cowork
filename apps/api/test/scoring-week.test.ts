import { describe, it, expect } from "vitest";
import { weekKeyOf, weekWindow } from "../src/application/scoring/week";

const ICT = "Asia/Ho_Chi_Minh"; // UTC+7, no DST
const UTC = "UTC";

describe("weekKeyOf", () => {
  it("anchors to the Monday of the week (mid-week)", () => {
    // 2026-07-27 is a Monday. A Wednesday in that week → same key.
    expect(weekKeyOf(new Date("2026-07-29T10:00:00Z"), UTC)).toBe("2026-07-27");
  });

  it("keeps Sunday 23:59 in the same week", () => {
    expect(weekKeyOf(new Date("2026-08-02T23:59:00Z"), UTC)).toBe("2026-07-27");
    // Monday 00:00 UTC rolls to the next week
    expect(weekKeyOf(new Date("2026-08-03T00:00:00Z"), UTC)).toBe("2026-08-03");
  });

  it("uses the LOCAL timezone boundary: a Sunday-evening-UTC instant is Monday in ICT", () => {
    // 2026-08-02T18:00Z = 2026-08-03T01:00 ICT (Monday) → next week in ICT, prior week in UTC.
    const inst = new Date("2026-08-02T18:00:00Z");
    expect(weekKeyOf(inst, UTC)).toBe("2026-07-27");
    expect(weekKeyOf(inst, ICT)).toBe("2026-08-03");
  });
});

describe("weekWindow", () => {
  it("returns a 7-day [Mon 00:00, next-Mon 00:00) window in ICT", () => {
    const { start, end } = weekWindow("2026-07-27", ICT);
    // Monday 00:00 ICT = Sunday 17:00 UTC.
    expect(start.toISOString()).toBe("2026-07-26T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-02T17:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it("handles month rollover", () => {
    const { start, end } = weekWindow("2026-07-27", UTC);
    expect(start.toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});
