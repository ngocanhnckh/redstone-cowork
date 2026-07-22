import { describe, it, expect } from "vitest";
import { clip, stamp, shotPaths, buildDomPrompt, buildRegionPrompt, type DomPin } from "./pointPrompt";

describe("clip", () => {
  it("collapses whitespace and trims", () => {
    expect(clip("  a\n  b\t c ")).toBe("a b c");
  });
  it("caps to max with an ellipsis", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
  });
  it("tolerates null/undefined", () => {
    expect(clip(undefined as unknown as string)).toBe("");
  });
});

describe("stamp", () => {
  it("is filename-safe (no colons or dots)", () => {
    const s = stamp(new Date("2026-07-21T18:40:01.123Z"));
    expect(s).toBe("2026-07-21T18-40-01-123Z");
    expect(s).not.toMatch(/[:.]/);
  });
});

describe("shotPaths", () => {
  it("builds absolute + project-relative paths under .rcw-shots", () => {
    expect(shotPaths("/home/me/proj", "x.png")).toEqual({
      abs: "/home/me/proj/.rcw-shots/x.png",
      rel: "./.rcw-shots/x.png",
    });
  });
  it("normalises a trailing slash on cwd", () => {
    expect(shotPaths("/home/me/proj/", "x.png").abs).toBe("/home/me/proj/.rcw-shots/x.png");
  });
});

const pin = (over: Partial<DomPin> = {}): DomPin => ({
  n: 1,
  selector: "button.save",
  domPath: "main > form > button.save",
  text: "Save changes",
  box: { x: 812.4, y: 430.6, w: 96, h: 36 },
  shot: "./.rcw-shots/a.png",
  note: "make it blue",
  ...over,
});

describe("buildDomPrompt", () => {
  it("includes url, count, selector, path, rounded box, text and note", () => {
    const out = buildDomPrompt("https://x/settings", [pin()]);
    expect(out).toContain("https://x/settings — 1 item.");
    expect(out).toContain("1. `button.save`   (main > form > button.save)");
    expect(out).toContain("box: x=812 y=431 w=96 h=36");
    expect(out).toContain('text: "Save changes"');
    expect(out).toContain("→ make it blue");
  });
  it("never references a screenshot (element feedback is text-only)", () => {
    const out = buildDomPrompt("https://x", [pin({ shot: "./.rcw-shots/a.png" })]);
    expect(out).not.toContain("shot");
    expect(out).not.toContain(".rcw-shots");
  });
  it("pluralises and separates multiple pins", () => {
    const out = buildDomPrompt("https://x", [pin({ n: 1 }), pin({ n: 2, note: "second" })]);
    expect(out).toContain("— 2 items.");
    expect(out).toContain("2. `button.save`");
    expect(out).toContain("→ second");
  });
  it("falls back to (no note) for an empty note", () => {
    expect(buildDomPrompt("https://x", [pin({ note: "  " })])).toContain("→ (no note)");
  });
});

describe("buildRegionPrompt", () => {
  it("includes the url, image path and command", () => {
    const out = buildRegionPrompt("https://x/pricing", "./.rcw-shots/r.png", "tighten the spacing");
    expect(out).toContain("https://x/pricing");
    expect(out).toContain("Image (readable on this machine): ./.rcw-shots/r.png");
    expect(out).toContain("→ tighten the spacing");
  });
  it("says so when the screenshot is missing instead of referencing a bad path", () => {
    const out = buildRegionPrompt("https://x", null, "fix this");
    expect(out).toContain("screenshot capture failed");
    expect(out).not.toContain(".rcw-shots");
    expect(out).toContain("→ fix this");
  });
});
