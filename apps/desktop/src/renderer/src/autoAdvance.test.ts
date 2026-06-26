import { describe, it, expect } from "vitest";
import { pickFocus, nextAfterAnswer } from "./autoAdvance";

describe("autoAdvance", () => {
  it("pickFocus keeps current if still queued, else first, else null", () => {
    expect(pickFocus([{ id: "a" }, { id: "b" }], "b")).toBe("b");
    expect(pickFocus([{ id: "a" }, { id: "b" }], "z")).toBe("a");
    expect(pickFocus([{ id: "a" }], null)).toBe("a");
    expect(pickFocus([], "a")).toBeNull();
  });
  it("nextAfterAnswer returns first id that isn't the answered one", () => {
    expect(nextAfterAnswer([{ id: "a" }, { id: "b" }], "a")).toBe("b");
    expect(nextAfterAnswer([{ id: "a" }], "a")).toBeNull();
    expect(nextAfterAnswer([{ id: "b" }, { id: "c" }], "a")).toBe("b");
  });
});
