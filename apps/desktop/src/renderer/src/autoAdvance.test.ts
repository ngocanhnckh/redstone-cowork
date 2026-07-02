import { describe, it, expect } from "vitest";
import { pickFocus, nextWaiting } from "./autoAdvance";

describe("autoAdvance", () => {
  it("pickFocus is sticky: keeps current while the session exists, else first waiting, else null", () => {
    // current still exists (even if not in the waiting queue) → keep it
    expect(pickFocus([{ id: "a" }], [{ id: "a" }, { id: "b" }], "b")).toBe("b");
    expect(pickFocus([{ id: "a" }, { id: "b" }], [{ id: "a" }, { id: "b" }], "b")).toBe("b");
    // current gone → first waiting
    expect(pickFocus([{ id: "a" }, { id: "b" }], [{ id: "a" }, { id: "b" }], "z")).toBe("a");
    // no current → first waiting
    expect(pickFocus([{ id: "a" }], [{ id: "a" }], null)).toBe("a");
    // nothing waiting and current gone → null
    expect(pickFocus([], [], "a")).toBeNull();
  });
  it("nextWaiting only targets sessions with a pending actionable decision, skipping excludeId", () => {
    const queue = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const decisions = [
      { sessionId: "a", kind: "completion" }, // passive — a is in the queue but doesn't need input
      { sessionId: "b", kind: "question" },   // actionable
      { sessionId: "c", kind: "permission" }, // actionable
    ];
    // b is first actionable; a (passive) is skipped even though it's first in the queue.
    expect(nextWaiting(queue, decisions, "x")).toBe("b");
    // exclude the one we just messaged → next actionable is c.
    expect(nextWaiting(queue, decisions, "b")).toBe("c");
  });
  it("nextWaiting returns null when nothing needs input (no jumping to a thinking/passive session)", () => {
    const queue = [{ id: "a" }, { id: "b" }];
    expect(nextWaiting(queue, [{ sessionId: "a", kind: "completion" }], "z")).toBeNull();
    expect(nextWaiting(queue, [], "z")).toBeNull();
    // only actionable session is the excluded one → null (stay put)
    expect(nextWaiting(queue, [{ sessionId: "a", kind: "question" }], "a")).toBeNull();
  });
});
