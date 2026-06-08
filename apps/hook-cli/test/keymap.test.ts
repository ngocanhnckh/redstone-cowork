import { describe, it, expect } from "vitest";
import { deliveryToKeys } from "../src/keymap";

const base = { id: "d1", sessionId: "s", title: "t", body: {}, status: "resolved", createdAt: new Date().toISOString(), resolvedAt: null, deliveredAt: null };

describe("deliveryToKeys", () => {
  it("instruction -> literal text + Enter", () => {
    expect(deliveryToKeys({ ...base, kind: "instruction", options: [], resolution: { choice: null, answers: null, custom: "pnpm test" } } as never))
      .toEqual([["-l", "pnpm test"], ["Enter"]]);
  });
  it("permission Allow -> digit of the option position", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }, { label: "Deny" }], resolution: { choice: "Allow", answers: null, custom: null } } as never))
      .toEqual([["1"], ["Enter"]]);
  });
  it("question option pick -> its digit", () => {
    expect(deliveryToKeys({ ...base, kind: "question", options: [{ label: "A" }, { label: "B" }], resolution: { choice: "B", answers: null, custom: null } } as never))
      .toEqual([["2"], ["Enter"]]);
  });
  it("local-answered or unmapped -> null (skip)", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }], resolution: { choice: "__local__", answers: null, custom: null } } as never)).toBeNull();
    expect(deliveryToKeys({ ...base, kind: "question", options: [], resolution: { choice: null, answers: null, custom: "free text" } } as never)).toBeNull();
  });
});
