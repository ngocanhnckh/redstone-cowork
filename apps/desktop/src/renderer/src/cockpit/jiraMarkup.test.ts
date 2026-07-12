import { describe, it, expect } from "vitest";
import { markdownToJira } from "./jiraMarkup";

describe("markdownToJira", () => {
  it("empty / whitespace → empty string", () => {
    expect(markdownToJira("")).toBe("");
    expect(markdownToJira("   \n  ")).toBe("");
  });

  it("headings map # → h1. .. h6.", () => {
    expect(markdownToJira("# Title")).toBe("h1. Title");
    expect(markdownToJira("### Sub")).toBe("h3. Sub");
  });

  it("bold **x** and __x__ → *x*", () => {
    expect(markdownToJira("a **bold** b")).toBe("a *bold* b");
    expect(markdownToJira("__strong__")).toBe("*strong*");
  });

  it("italic *x* and _x_ → _x_ (and does not corrupt bold)", () => {
    expect(markdownToJira("an *italic* word")).toBe("an _italic_ word");
    expect(markdownToJira("_already_")).toBe("_already_");
    // bold must not be turned into italic
    expect(markdownToJira("**b** and *i*")).toBe("*b* and _i_");
  });

  it("inline code → {{ }} and passes its contents through untouched", () => {
    expect(markdownToJira("run `npm **install**` now")).toBe("run {{npm **install**}} now");
  });

  it("links [t](u) → [t|u]", () => {
    expect(markdownToJira("see [docs](https://x.com/a)")).toBe("see [docs|https://x.com/a]");
  });

  it("bullet lists → * with nesting by indent", () => {
    expect(markdownToJira("- one\n- two")).toBe("* one\n* two");
    expect(markdownToJira("- top\n  - nested")).toBe("* top\n** nested");
  });

  it("numbered lists → # with nesting", () => {
    expect(markdownToJira("1. first\n2. second")).toBe("# first\n# second");
    expect(markdownToJira("1. top\n   1. child")).toBe("# top\n## child");
  });

  it("blockquote → bq. and hr → ----", () => {
    expect(markdownToJira("> quoted")).toBe("bq. quoted");
    expect(markdownToJira("---")).toBe("----");
  });

  it("fenced code block → {code:lang} … {code}", () => {
    expect(markdownToJira("```js\nconst x = 1;\n```")).toBe("{code:js}\nconst x = 1;\n{code}");
    expect(markdownToJira("```\nplain\n```")).toBe("{code}\nplain\n{code}");
  });

  it("fenced code contents are NOT emphasis/link converted", () => {
    expect(markdownToJira("```\na **b** [c](d)\n```")).toBe("{code}\na **b** [c](d)\n{code}");
  });

  it("strikethrough ~~x~~ → -x-", () => {
    expect(markdownToJira("~~gone~~")).toBe("-gone-");
  });

  it("a realistic mixed document", () => {
    const md = [
      "# Plan",
      "",
      "Ship the **login** flow and fix `authGuard`.",
      "",
      "- step one",
      "- step [two](https://j/RCW-2)",
    ].join("\n");
    expect(markdownToJira(md)).toBe(
      ["h1. Plan", "", "Ship the *login* flow and fix {{authGuard}}.", "", "* step one", "* step [two|https://j/RCW-2]"].join("\n"),
    );
  });
});
