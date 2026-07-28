import { describe, it, expect } from "vitest";
import { projectSlug, parseTranscriptHead, parseMarkers } from "../src/transcript/scan.js";

describe("projectSlug", () => {
  it("replaces path separators with dashes", () => {
    expect(projectSlug("/Users/me/Code/app")).toBe("-Users-me-Code-app");
  });

  // The regression this package exists to fix: hook-cli's newestTranscript replaced
  // only "/", so any cwd with a dot resolved to a directory that never exists.
  it("replaces dots as well as slashes", () => {
    expect(projectSlug("/Users/me/Code/foo.bar")).toBe("-Users-me-Code-foo-bar");
    expect(projectSlug("/home/u/.config/thing")).toBe("-home-u--config-thing");
    expect(projectSlug("/srv/app-v1.2.3")).toBe("-srv-app-v1-2-3");
  });

  it("leaves a slug with no separators untouched", () => {
    expect(projectSlug("project")).toBe("project");
  });

  it("handles an empty cwd", () => {
    expect(projectSlug("")).toBe("");
  });
});

describe("parseTranscriptHead", () => {
  it("reads cwd and the first real user prompt", () => {
    const head = [
      JSON.stringify({ type: "user", cwd: "/srv/app", message: { role: "user", content: "fix the build" } }),
    ].join("\n");
    expect(parseTranscriptHead(head)).toEqual({ cwd: "/srv/app", title: "fix the build" });
  });

  it("skips tool-result / command noise when picking a title", () => {
    const head = [
      JSON.stringify({ type: "user", cwd: "/srv/app", message: { role: "user", content: "<bash-input>ls</bash-input>" } }),
      JSON.stringify({ type: "user", message: { role: "user", content: "the real prompt" } }),
    ].join("\n");
    expect(parseTranscriptHead(head).title).toBe("the real prompt");
  });

  it("reads a title out of an array content block", () => {
    const head = JSON.stringify({
      type: "user",
      cwd: "/srv/app",
      message: { role: "user", content: [{ type: "text", text: "array prompt" }] },
    });
    expect(parseTranscriptHead(head).title).toBe("array prompt");
  });

  it("returns nulls for garbage without throwing", () => {
    expect(parseTranscriptHead("not json\n{oops")).toEqual({ cwd: null, title: null });
  });
});

describe("parseMarkers", () => {
  // Shapes verified against a live Claude Code transcript — these are what let the
  // agent-free edition recover metadata the hosted edition gets from hooks.
  const transcript = [
    JSON.stringify({ type: "mode", mode: "plan" }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
    JSON.stringify({ type: "last-prompt", lastPrompt: "continue" }),
    JSON.stringify({ type: "ai-title", aiTitle: "Redesign the cockpit" }),
    JSON.stringify({ type: "mode", mode: "normal" }),
    JSON.stringify({ type: "permission-mode", permissionMode: "bypassPermissions" }),
    JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 87411 }),
    JSON.stringify({ type: "system", subtype: "away_summary", content: "We're redesigning the app." }),
  ].join("\n");

  it("extracts every marker", () => {
    expect(parseMarkers(transcript)).toEqual({
      aiTitle: "Redesign the cockpit",
      lastPrompt: "continue",
      mode: "normal",
      permissionMode: "bypassPermissions",
      awaySummary: "We're redesigning the app.",
      lastTurnDurationMs: 87411,
    });
  });

  it("takes the NEWEST value when a marker repeats", () => {
    // "normal" is written after "plan" above — the later one must win.
    expect(parseMarkers(transcript).mode).toBe("normal");
  });

  it("returns all-null for a transcript with no markers", () => {
    const plain = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } });
    expect(parseMarkers(plain)).toEqual({
      aiTitle: null, lastPrompt: null, mode: null,
      permissionMode: null, awaySummary: null, lastTurnDurationMs: null,
    });
  });

  it("never throws on malformed lines", () => {
    expect(() => parseMarkers('{"type":"mode"\ngarbage\n')).not.toThrow();
  });
});
