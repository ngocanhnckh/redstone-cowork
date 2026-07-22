import { describe, it, expect } from "vitest";
import { annotateJs, annotateStatusJs, ANNOTATE_TEARDOWN_JS, ANNOTATE_MARK } from "./browserAnnotate";

// The overlay runs as a string injected into the guest, so tsc can't see inside it.
// These parse the emitted program with `new Function` to catch syntax errors, and
// assert the mode literal + marker are wired in.
describe("annotateJs", () => {
  for (const mode of ["dom", "region"] as const) {
    it(`emits syntactically valid JS for ${mode} mode`, () => {
      const code = annotateJs(mode);
      expect(() => new Function(code)).not.toThrow();
    });
    it(`substitutes the ${mode} mode literal`, () => {
      expect(annotateJs(mode)).toContain(`var MODE = "${mode}"`);
    });
  }
  it("embeds the console marker the host listens for", () => {
    expect(annotateJs("dom")).toContain(JSON.stringify(ANNOTATE_MARK));
  });
});

describe("annotate helper scripts", () => {
  it("teardown is valid JS", () => {
    expect(() => new Function(ANNOTATE_TEARDOWN_JS)).not.toThrow();
  });
  it("status script is valid JS and carries the text", () => {
    const code = annotateStatusJs("uploading screenshot…");
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain("uploading screenshot…");
  });
});
