import { describe, it, expect } from "vitest";
import {
  correlate,
  deriveState,
  isBlockedOnUser,
  isClaudePane,
  wrapperIdOf,
  IDLE_BACKSTOP_MS,
  TURN_SETTLE_MS,
  PROMPT_SUSPECT_MS,
  type Pane,
  type ScannedFile,
} from "./session-derive";

const file = (id: string, cwd: string, mtimeMs: number, ageMs = 0): { f: ScannedFile; head: string } => ({
  f: { path: `/h/.claude/projects/${cwd.replace(/[/.]/g, "-")}/${id}.jsonl`, id, dir: "d", size: 100, mtimeMs, ageMs },
  head: JSON.stringify({ type: "user", cwd, message: { role: "user", content: `work in ${cwd}` } }),
});

// Default to a pane the probe resolved as running Claude (claudePid set), since that
// is what a real probe reports; tests that need "no claude here" set claudePid: null.
const pane = (over: Partial<Pane>): Pane => ({
  session: "s", window: 0, pane: 0, pid: 1, cwd: "/srv/app",
  command: "claude", createdAt: 0, attached: false, claudePid: 99, resumeId: null, ...over,
});

function build(entries: Array<{ f: ScannedFile; head: string }>) {
  const heads: Record<string, string> = {};
  for (const e of entries) heads[e.f.path] = e.head;
  return { files: entries.map((e) => e.f), heads };
}

describe("isClaudePane / wrapperIdOf", () => {
  it("recognises the claude CLI as the foreground command", () => {
    // The probe's subtree search is authoritative when present.
    expect(isClaudePane(pane({ command: "claude", claudePid: 42 }))).toBe(true);
    // THE case that matters: the cockpit's wrapper runs claude inside a shell command
    // string, so the pane's foreground command is `bash` while claude is its child.
    // Matching on the pane command alone missed every wrapper-launched session.
    expect(isClaudePane(pane({ command: "bash", claudePid: 42 }))).toBe(true);
    // The wrapper's hidden poller window runs node with no claude beneath it.
    expect(isClaudePane(pane({ command: "node", claudePid: null }))).toBe(false);
    expect(isClaudePane(pane({ command: "bash", claudePid: null }))).toBe(false);
    // Fallback for a probe that predates claudePid.
    expect(isClaudePane({ ...pane({ command: "claude" }), claudePid: undefined })).toBe(true);
    expect(isClaudePane({ ...pane({ command: "node" }), claudePid: undefined })).toBe(false);
  });

  it("extracts a wrapper id only from cockpit-launched sessions", () => {
    expect(wrapperIdOf("rcw-4e59c7ee")).toBe("4e59c7ee");
    expect(wrapperIdOf("accelrx")).toBeNull();
    expect(wrapperIdOf("rcw-")).toBeNull();
  });
});

describe("correlate", () => {
  it("matches a live pane to the newest transcript in its cwd", () => {
    const older = file("old", "/srv/app", 1_000);
    const newer = file("new", "/srv/app", 2_000);
    const { files, heads } = build([older, newer]);
    const out = correlate(files, heads, [pane({ session: "rcw-abc123", cwd: "/srv/app" })]);

    const live = out.filter((s) => s.live);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe("new");
    expect(live[0].wrapperId).toBe("abc123");
    expect(live[0].paneTarget).toBe("rcw-abc123:0.0");
    // The older transcript survives as a resumable conversation.
    expect(out.find((s) => s.id === "old")!.live).toBe(false);
  });

  it("adopts a hand-started tmux session, not just rcw- ones", () => {
    // This is the case the hosted edition cannot see at all: a session started by
    // `tmux new -s accelrx` with no wrapper, no RCW_WRAPPER_ID and no poller.
    const { files, heads } = build([file("s1", "/home/u/accelrx", 5_000)]);
    const out = correlate(files, heads, [pane({ session: "accelrx", cwd: "/home/u/accelrx" })]);
    expect(out[0].live).toBe(true);
    expect(out[0].tmuxSession).toBe("accelrx");
    expect(out[0].wrapperId).toBeNull(); // no wrapper — but still fully managed
  });

  it("reads the real cwd from the transcript, since the project slug is lossy", () => {
    // "/srv/app.v2" slugs to "-srv-app-v2", which cannot be reversed.
    const { files, heads } = build([file("s1", "/srv/app.v2", 1_000)]);
    const out = correlate(files, heads, [pane({ cwd: "/srv/app.v2" })]);
    expect(out[0].cwd).toBe("/srv/app.v2");
    expect(out[0].live).toBe(true);
  });

  it("gives two Claudes in one folder a pane each, newest first", () => {
    const a = file("a", "/srv/app", 3_000);
    const b = file("b", "/srv/app", 2_000);
    const { files, heads } = build([a, b]);
    const out = correlate(files, heads, [
      pane({ session: "one", cwd: "/srv/app", pane: 0 }),
      pane({ session: "two", cwd: "/srv/app", pane: 1 }),
    ]);
    const live = out.filter((s) => s.live);
    expect(live).toHaveLength(2);
    expect(new Set(live.map((s) => s.paneTarget)).size).toBe(2); // no double-claiming
    expect(live[0].id).toBe("a");
  });

  it("keeps transcripts that have no live pane", () => {
    const { files, heads } = build([file("s1", "/srv/app", 1_000, 90_000)]);
    const out = correlate(files, heads, []);
    expect(out).toHaveLength(1);
    expect(out[0].live).toBe(false);
    expect(out[0].paneTarget).toBeNull();
  });

  it("ignores panes that aren't running Claude", () => {
    const { files, heads } = build([file("s1", "/srv/app", 1_000)]);
    const out = correlate(files, heads, [pane({ command: "node", claudePid: null }), pane({ command: "bash", claudePid: null })]);
    expect(out[0].live).toBe(false);
  });

  it("skips files whose head hasn't been fetched, and those with no cwd", () => {
    const withCwd = file("a", "/srv/app", 2_000);
    const noCwd = file("b", "/srv/other", 1_000);
    const { files } = build([withCwd, noCwd]);
    const heads = { [withCwd.f.path]: withCwd.head, [noCwd.f.path]: '{"type":"user"}' };
    const out = correlate(files, heads, []);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });
});

// --- state derivation -------------------------------------------------------

const asst = (content: unknown[], stop?: string) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", stop_reason: stop, content } });
const usr = (content: unknown) => JSON.stringify({ type: "user", message: { role: "user", content } });
const text = (t: string) => ({ type: "text", text: t });
const toolUse = (id: string, name: string, input: unknown = {}) => ({ type: "tool_use", id, name, input });
const toolResult = (id: string) => ({ type: "tool_result", tool_use_id: id, content: "done" });

describe("deriveState", () => {
  it("is working while a tool call has no result", () => {
    const t = [usr("go"), asst([toolUse("t1", "Bash")], "tool_use")].join("\n");
    const s = deriveState(t, 500);
    expect(s.working).toBe(true);
    expect(s.pendingTool).toMatchObject({ id: "t1", name: "Bash" });
  });

  it("clears the pending tool once its result arrives", () => {
    const t = [usr("go"), asst([toolUse("t1", "Bash")], "tool_use"), usr([toolResult("t1")])].join("\n");
    const s = deriveState(t, 500);
    expect(s.pendingTool).toBeNull();
  });

  it("matches results to calls by id, not by position", () => {
    // Two parallel calls; only the second is answered.
    const t = [
      usr("go"),
      asst([toolUse("t1", "Read"), toolUse("t2", "Bash")], "tool_use"),
      usr([toolResult("t2")]),
    ].join("\n");
    const s = deriveState(t, 500);
    expect(s.pendingTool).toMatchObject({ id: "t1", name: "Read" });
  });

  it("is working after a user prompt with no reply yet", () => {
    const t = [asst([text("previous answer")], "end_turn"), usr("do more")].join("\n");
    expect(deriveState(t, 300).working).toBe(true);
  });

  it("settles before declaring a finished turn idle", () => {
    const t = [usr("go"), asst([text("all done")], "end_turn")].join("\n");
    // Claude often writes prose then immediately starts another tool call, so a turn
    // is only "over" once the file stops changing.
    expect(deriveState(t, 500).working).toBe(true);
    expect(deriveState(t, TURN_SETTLE_MS + 100).working).toBe(false);
    expect(deriveState(t, TURN_SETTLE_MS + 100).turnEnded).toBe(true);
  });

  it("forces idle once the transcript goes stale, whatever the last line says", () => {
    // Claude killed mid-tool would otherwise show "working" forever.
    const t = [usr("go"), asst([toolUse("t1", "Bash")], "tool_use")].join("\n");
    const s = deriveState(t, IDLE_BACKSTOP_MS + 1_000);
    expect(s.working).toBe(false);
    expect(s.pendingTool).toMatchObject({ name: "Bash" }); // still reported, just not "working"
  });

  it("surfaces the markers Claude Code writes", () => {
    const t = [
      asst([text("hi")], "end_turn"),
      JSON.stringify({ type: "ai-title", aiTitle: "Fix the build" }),
      JSON.stringify({ type: "permission-mode", permissionMode: "plan" }),
      JSON.stringify({ type: "system", subtype: "away_summary", content: "Fixing CI." }),
    ].join("\n");
    const s = deriveState(t, 5_000);
    expect(s.markers.aiTitle).toBe("Fix the build");
    expect(s.markers.permissionMode).toBe("plan");
    expect(s.markers.awaySummary).toBe("Fixing CI.");
  });

  it("tolerates a half-written trailing line", () => {
    const t = [usr("go"), asst([text("ok")], "end_turn")].join("\n") + '\n{"type":"assistant","messa';
    expect(() => deriveState(t, 100)).not.toThrow();
    expect(deriveState(t, 100).markers.aiTitle).toBeNull();
  });

  it("returns a safe default for an empty tail", () => {
    const s = deriveState("", 100_000);
    expect(s.working).toBe(false);
    expect(s.pendingTool).toBeNull();
  });
});

describe("isBlockedOnUser", () => {
  it("treats AskUserQuestion as blocking immediately", () => {
    // It cannot be a slow command — Claude literally cannot proceed without an answer.
    const t = [usr("go"), asst([toolUse("t1", "AskUserQuestion", { questions: [{ question: "Which?" }] })], "tool_use")].join("\n");
    expect(isBlockedOnUser(deriveState(t, 200), 200)).toBe(true);
  });

  it("waits before assuming a plain tool call is a permission prompt", () => {
    // A permission prompt isn't written to the transcript until it's answered, so an
    // unresolved Bash call is indistinguishable from a slow command at first.
    const t = [usr("go"), asst([toolUse("t1", "Bash")], "tool_use")].join("\n");
    expect(isBlockedOnUser(deriveState(t, 500), 500)).toBe(false);
    expect(isBlockedOnUser(deriveState(t, PROMPT_SUSPECT_MS + 100), PROMPT_SUSPECT_MS + 100)).toBe(true);
  });

  it("is false with nothing outstanding", () => {
    const t = [usr("go"), asst([text("done")], "end_turn")].join("\n");
    expect(isBlockedOnUser(deriveState(t, 10_000), 10_000)).toBe(false);
  });
});
