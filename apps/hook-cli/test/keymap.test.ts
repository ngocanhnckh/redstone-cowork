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

  it("multi-question answers -> per question: chosen digit then Enter to advance", () => {
    const body = { tool_input: { questions: [
      { question: "Framework?", options: [{ label: "React" }, { label: "Vue" }] },
      { question: "Bundler?", options: [{ label: "Vite" }, { label: "Webpack" }, { label: "esbuild" }] },
    ] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [{ label: "React" }, { label: "Vue" }],
      body, resolution: { choice: null, answers: { "Framework?": "Vue", "Bundler?": "esbuild" }, custom: null } } as never))
      .toEqual([["2"], ["Enter"], ["3"], ["Enter"]]);
  });

  it("multiSelect question -> a digit per chosen option, then one Enter to advance", () => {
    const body = { tool_input: { questions: [
      { question: "Weekend?", multiSelect: true, options: [{ label: "Reading" }, { label: "Hiking" }, { label: "Gaming" }, { label: "Movies" }] },
    ] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Weekend?": ["Reading", "Gaming"] }, custom: null } } as never))
      .toEqual([["1"], ["3"], ["Enter"]]);
  });

  it("mixed single + multiSelect questions -> correct interleaved sequence", () => {
    const body = { tool_input: { questions: [
      { question: "Season?", options: [{ label: "Spring" }, { label: "Summer" }, { label: "Autumn" }, { label: "Winter" }] },
      { question: "Weekend?", multiSelect: true, options: [{ label: "Reading" }, { label: "Hiking" }, { label: "Gaming" }] },
    ] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Season?": "Autumn", "Weekend?": ["Hiking", "Gaming"] }, custom: null } } as never))
      .toEqual([["3"], ["Enter"], ["2"], ["3"], ["Enter"]]);
  });

  it("multi-question with a missing answer -> null (never half-drive the form)", () => {
    const body = { tool_input: { questions: [
      { question: "Framework?", options: [{ label: "React" }, { label: "Vue" }] },
      { question: "Bundler?", options: [{ label: "Vite" }, { label: "Webpack" }] },
    ] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Framework?": "React" }, custom: null } } as never))
      .toBeNull();
  });

  it("single-question answers map -> [digit, Enter] (same as the choice path)", () => {
    const body = { tool_input: { questions: [
      { question: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] },
    ] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [{ label: "Yes" }, { label: "No" }],
      body, resolution: { choice: null, answers: { "Proceed?": "No" }, custom: null } } as never))
      .toEqual([["2"], ["Enter"]]);
  });
  it("local-answered or unmapped -> null (skip)", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }], resolution: { choice: "__local__", answers: null, custom: null } } as never)).toBeNull();
    expect(deliveryToKeys({ ...base, kind: "question", options: [], resolution: { choice: null, answers: null, custom: "free text" } } as never)).toBeNull();
  });

  it("mode delivery with btabs=2 -> two BTab sequences", () => {
    expect(deliveryToKeys({ ...base, kind: "mode", options: [], resolution: null, body: { btabs: 2 } } as never))
      .toEqual([["BTab"], ["BTab"]]);
  });

  it("mode delivery with btabs=0 -> null", () => {
    expect(deliveryToKeys({ ...base, kind: "mode", options: [], resolution: null, body: { btabs: 0 } } as never))
      .toBeNull();
  });

  it("mode delivery with missing body -> null", () => {
    expect(deliveryToKeys({ ...base, kind: "mode", options: [], resolution: null } as never))
      .toBeNull();
  });

  it("mode delivery with btabs=1 -> single BTab", () => {
    expect(deliveryToKeys({ ...base, kind: "mode", options: [], resolution: null, body: { btabs: 1 } } as never))
      .toEqual([["BTab"]]);
  });
});
