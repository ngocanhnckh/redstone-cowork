import { describe, it, expect } from "vitest";
import { deliveryToKeys } from "../src/keymap";

const base = { id: "d1", sessionId: "s", title: "t", body: {}, status: "resolved", createdAt: new Date().toISOString(), resolvedAt: null, deliveredAt: null };

describe("deliveryToKeys", () => {
  it("instruction -> literal text + Enter", () => {
    expect(deliveryToKeys({ ...base, kind: "instruction", options: [], resolution: { choice: null, answers: null, custom: "pnpm test" } } as never))
      .toEqual([["-l", "pnpm test"], ["Enter"]]);
  });
  it("bare interrupt -> a single Escape (abort, no text)", () => {
    expect(deliveryToKeys({ ...base, kind: "interrupt", options: [], resolution: { choice: null, answers: null, custom: null } } as never))
      .toEqual([["Escape"]]);
  });
  it("interrupt with text -> Escape, then the replacement, then Enter", () => {
    expect(deliveryToKeys({ ...base, kind: "interrupt", options: [], resolution: { choice: null, answers: null, custom: "do X instead" } } as never))
      .toEqual([["Escape"], ["-l", "do X instead"], ["Enter"]]);
  });
  it("permission Allow -> '1' + Enter (the TUI's Yes option)", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }, { label: "Deny" }], resolution: { choice: "Allow", answers: null, custom: null } } as never))
      .toEqual([["1"], ["Enter"]]);
  });
  it("permission Deny -> Escape (cancels the tool, no guessing the No digit)", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }, { label: "Deny" }], resolution: { choice: "Deny", answers: null, custom: null } } as never))
      .toEqual([["Escape"]]);
  });
  it("question option pick -> its digit", () => {
    expect(deliveryToKeys({ ...base, kind: "question", options: [{ label: "A" }, { label: "B" }], resolution: { choice: "B", answers: null, custom: null } } as never))
      .toEqual([["2"], ["Enter"]]);
  });
  it("question custom free-text answer -> Escape then the text + Enter (never dropped)", () => {
    expect(deliveryToKeys({ ...base, kind: "question", options: [{ label: "A" }, { label: "B" }], resolution: { choice: null, answers: null, custom: "actually do it this other way" } } as never))
      .toEqual([["Escape"], ["-l", "actually do it this other way"], ["Enter"]]);
  });
  it("permission custom free-text reply -> Escape then the text + Enter", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }, { label: "Deny" }], resolution: { choice: null, answers: null, custom: "only for src/" } } as never))
      .toEqual([["Escape"], ["-l", "only for src/"], ["Enter"]]);
  });

  it("two single-select questions -> a digit each (auto-advance), then one Enter to submit review", () => {
    const body = { tool_input: { questions: [
      { question: "Framework?", options: [{ label: "React" }, { label: "Vue" }] },
      { question: "Bundler?", options: [{ label: "Vite" }, { label: "Webpack" }, { label: "esbuild" }] },
    ] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [{ label: "React" }, { label: "Vue" }],
      body, resolution: { choice: null, answers: { "Framework?": "Vue", "Bundler?": "esbuild" }, custom: null } } as never))
      .toEqual([["2"], ["3"], ["Enter"]]);
  });

  it("single multiSelect question -> toggle digits, Down past every row (K+1) to Submit, Enter to advance, Enter to submit", () => {
    const body = { tool_input: { questions: [
      { question: "Weekend?", multiSelect: true, options: [{ label: "Reading" }, { label: "Hiking" }, { label: "Gaming" }, { label: "Movies" }] },
    ] } };
    // K=4 options -> 5 Downs to reach the Submit button
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Weekend?": ["Reading", "Gaming"] }, custom: null } } as never))
      .toEqual([["1"], ["3"], ["Down"], ["Down"], ["Down"], ["Down"], ["Down"], ["Enter"], ["Enter"]]);
  });

  it("mixed single + multiSelect (last) -> single auto-advances, multi walks to Submit, then final submit", () => {
    const body = { tool_input: { questions: [
      { question: "Season?", options: [{ label: "Spring" }, { label: "Summer" }, { label: "Autumn" }, { label: "Winter" }] },
      { question: "Weekend?", multiSelect: true, options: [{ label: "Reading" }, { label: "Hiking" }, { label: "Gaming" }] },
    ] } };
    // Season=Autumn -> "3" (auto-advances); Weekend toggles "2","3"; K=3 -> 4 Downs; Enter advances to review; Enter submits
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Season?": "Autumn", "Weekend?": ["Hiking", "Gaming"] }, custom: null } } as never))
      .toEqual([["3"], ["2"], ["3"], ["Down"], ["Down"], ["Down"], ["Down"], ["Enter"], ["Enter"]]);
  });

  it("single-select CUSTOM answer -> Down past options to Other, type, Enter", () => {
    const body = { tool_input: { questions: [
      { question: "Framework?", options: [{ label: "React" }, { label: "Vue" }] },
    ] } };
    // "Svelte" is not an option -> custom: K=2 Downs to the Other row, type, commit
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Framework?": "Svelte" }, custom: null } } as never))
      .toEqual([["Down"], ["Down"], ["-l", "Svelte"], ["Enter"], ["Enter"]]);
  });

  it("single-select custom among multiple questions -> custom drives Other, preset uses digit", () => {
    const body = { tool_input: { questions: [
      { question: "Season?", options: [{ label: "Spring" }, { label: "Summer" }] },
      { question: "Framework?", options: [{ label: "React" }, { label: "Vue" }] },
    ] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Season?": "Spring", "Framework?": "Svelte" }, custom: null } } as never))
      .toEqual([["1"], ["Down"], ["Down"], ["-l", "Svelte"], ["Enter"], ["Enter"]]);
  });

  it("multiSelect CUSTOM (no presets) -> Down to Other, type, check, Down to Submit, submit", () => {
    const body = { tool_input: { questions: [
      { question: "Weekend?", multiSelect: true, options: [{ label: "Reading" }, { label: "Hiking" }] },
    ] } };
    // K=2 Downs to Other, type, Enter (check box), Down (-> Submit), Enter (advance), Enter (review)
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Weekend?": ["Bowling"] }, custom: null } } as never))
      .toEqual([["Down"], ["Down"], ["-l", "Bowling"], ["Enter"], ["Down"], ["Enter"], ["Enter"]]);
  });

  it("multiSelect preset + CUSTOM -> toggle preset digit, then drive Other", () => {
    const body = { tool_input: { questions: [
      { question: "Weekend?", multiSelect: true, options: [{ label: "Reading" }, { label: "Hiking" }, { label: "Gaming" }] },
    ] } };
    // toggle Hiking (digit 2); K=3 Downs to Other; type; check; Down to Submit; submit; review
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Weekend?": ["Hiking", "Knitting"] }, custom: null } } as never))
      .toEqual([["2"], ["Down"], ["Down"], ["Down"], ["-l", "Knitting"], ["Enter"], ["Down"], ["Enter"], ["Enter"]]);
  });

  it("option beyond position 9 -> null (not digit-addressable)", () => {
    const opts = Array.from({ length: 10 }, (_, i) => ({ label: `o${i}` }));
    const body = { tool_input: { questions: [{ question: "Q?", options: opts }] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Q?": "o9" }, custom: null } } as never))
      .toBeNull();
  });

  it("multiSelect with nothing picked -> null", () => {
    const body = { tool_input: { questions: [{ question: "Q?", multiSelect: true, options: [{ label: "A" }] }] } };
    expect(deliveryToKeys({ ...base, kind: "question", options: [],
      body, resolution: { choice: null, answers: { "Q?": [] }, custom: null } } as never))
      .toBeNull();
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
    // a question resolution with NO choice, custom, or answers has nothing to deliver
    expect(deliveryToKeys({ ...base, kind: "question", options: [], resolution: { choice: null, answers: null, custom: null } } as never)).toBeNull();
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
