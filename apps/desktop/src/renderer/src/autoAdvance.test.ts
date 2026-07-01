import { describe, it, expect } from "vitest";
import { pickFocus, nextAfterAnswer } from "./autoAdvance";

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
  it("nextAfterAnswer returns first id that isn't the answered one", () => {
    expect(nextAfterAnswer([{ id: "a" }, { id: "b" }], "a")).toBe("b");
    expect(nextAfterAnswer([{ id: "a" }], "a")).toBeNull();
    expect(nextAfterAnswer([{ id: "b" }, { id: "c" }], "a")).toBe("b");
  });
});
