import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSessions, findTranscriptPath } from "../src/scanner";
import { runCommand } from "../src/agent";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "rcw-scan-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function writeSession(slug: string, id: string, lines: object[]): string {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

describe("scanSessions", () => {
  it("recovers cwd + title from the transcript head and counts messages", () => {
    writeSession("-Users-me-Code-redstone-agent", "sess-a", [
      { type: "user", cwd: "/Users/me/Code/redstone-agent", message: { role: "user", content: "fix the auth bug" } },
      { type: "assistant", cwd: "/Users/me/Code/redstone-agent", message: { role: "assistant", content: [{ type: "text", text: "on it" }] } },
      { type: "user", cwd: "/Users/me/Code/redstone-agent", message: { role: "user", content: "thanks" } },
    ]);
    const out = scanSessions(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "sess-a", cwd: "/Users/me/Code/redstone-agent", title: "fix the auth bug", messageCount: 3 });
    expect(out[0].sizeBytes).toBeGreaterThan(0);
  });

  it("recovers cwd correctly even when the path itself contains dashes (no un-slugging)", () => {
    writeSession("-Users-me-Code-economy-mod-examplehost", "sess-b", [
      { cwd: "/Users/me/Code/economy-mod-examplehost", message: { role: "user", content: "hello" } },
    ]);
    const out = scanSessions(root);
    expect(out[0].cwd).toBe("/Users/me/Code/economy-mod-examplehost");
    expect(out[0].id).toBe("sess-b");
  });

  it("skips sessions whose cwd can't be recovered", () => {
    writeSession("-orphan", "sess-c", [{ type: "summary", content: "no cwd here" }]);
    expect(scanSessions(root)).toHaveLength(0);
  });

  it("returns [] when the projects root doesn't exist", () => {
    expect(scanSessions(join(root, "nope"))).toEqual([]);
  });

  it("findTranscriptPath locates a session by id regardless of the folder slug", () => {
    // Folder slug with a dot in it (Claude keeps dots) — recomputing from cwd would miss it.
    writeSession("-home-youruser-accelrx", "sess-x", [{ cwd: "/home/youruser/accelrx", message: { role: "user", content: "hi" } }]);
    const p = findTranscriptPath("sess-x", root);
    expect(p).toContain("-home-youruser-accelrx");
    expect(p).toContain("sess-x.jsonl");
    expect(findTranscriptPath("does-not-exist", root)).toBeNull();
  });

  it("orders nothing but reports every project dir", () => {
    writeSession("-a", "s1", [{ cwd: "/a", message: { role: "user", content: "x" } }]);
    writeSession("-b", "s2", [{ cwd: "/b", message: { role: "user", content: "y" } }]);
    expect(scanSessions(root).map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });
});

describe("runCommand", () => {
  it("fetch_history reads the transcript tail", async () => {
    const home = mkdtempSync(join(tmpdir(), "rcw-home-"));
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      const slug = "/tmp/proj".replace(/\//g, "-");
      const dir = join(home, ".claude", "projects", slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "s1.jsonl"),
        JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n" +
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello there" }] } }) + "\n");
      const res = await runCommand({ id: "c1", kind: "fetch_history", payload: { sessionId: "s1", cwd: "/tmp/proj" } });
      expect(res.ok).toBe(true);
      expect(JSON.stringify(res.messages)).toContain("hello there");
    } finally {
      process.env.HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns an error for an unknown command kind", async () => {
    const res = await runCommand({ id: "c2", kind: "explode", payload: {} });
    expect(res.ok).toBe(false);
  });

  it("passive_run without required payload fields fails cleanly", async () => {
    const res = await runCommand({ id: "c3", kind: "passive_run", payload: { sessionId: "x" } });
    expect(res).toEqual({ ok: false, error: "missing sessionId/cwd/message" });
  });
});
