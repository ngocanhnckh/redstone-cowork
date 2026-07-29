import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rcw-decisions-"));
vi.mock("electron", () => ({ app: { getPath: () => tmp } }));

import { deriveDecisions } from "./direct-provider";
import { markResolved, _resetForTest } from "./store";
import type { DirectSession } from "./session-engine";

const session = (over: Partial<DirectSession>): DirectSession => ({
  id: "sess-1", machine: "box", cwd: "/srv/app", gitBranch: null, wrapperId: null,
  status: "waiting", pendingDecisions: 1, waitingSince: "2026-07-29T10:00:00.000Z",
  latestAnswer: null, summary: null, todos: [], userTodos: [], tags: [], transcript: [],
  working: false, contextTokens: null, model: null, tokensInput: 0, tokensOutput: 0,
  tokenSeries: [], pinned: false, snoozedUntil: null, lastSeenAt: null, attachedAt: null,
  permissionMode: null, autoModeEnabled: false,
  paneTarget: "s:0.0", live: true, transcriptPath: "/t.jsonl",
  pendingToolId: "t1", pendingToolName: "Bash", pendingToolInput: { command: "rm -rf build" },
  ...over,
});

describe("deriveDecisions", () => {
  beforeEach(() => {
    fs.rmSync(path.join(tmp, "direct-state.json"), { force: true });
    _resetForTest();
  });

  it("builds a permission card carrying the real tool and input", () => {
    const [d] = deriveDecisions([session({})]);
    expect(d.kind).toBe("permission");
    // Richer than the hosted path, which only has the Notification message string —
    // here the actual command is in the title.
    expect(d.title).toContain("Bash");
    expect(d.title).toContain("rm -rf build");
    expect(d.options.map((o) => o.label)).toEqual(["Allow", "Deny"]);
    expect(d.body).toMatchObject({ tool_name: "Bash", deliverable: true });
  });

  it("builds an AskUserQuestion card with Claude's own options", () => {
    const [d] = deriveDecisions([
      session({
        pendingToolName: "AskUserQuestion",
        pendingToolInput: {
          questions: [{ question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] }],
        },
      }),
    ]);
    expect(d.kind).toBe("question");
    expect(d.title).toBe("Which database?");
    expect(d.options.map((o) => o.label)).toEqual(["Postgres", "SQLite"]);
  });

  it("keeps the card id stable so a tick can't spawn duplicates", () => {
    const s = session({});
    const first = deriveDecisions([s]);
    const second = deriveDecisions([s]);
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe("sess-1:t1");
  });

  it("gives parallel tool calls in one session distinct cards", () => {
    const a = session({ id: "s1", pendingToolId: "t1" });
    const b = session({ id: "s2", pendingToolId: "t2", pendingToolName: "Write" });
    const ids = deriveDecisions([a, b]).map((d) => d.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("suppresses a card the user already answered", () => {
    const s = session({});
    const [d] = deriveDecisions([s]);
    markResolved(d.id);
    // Without this the card reappears on the very next tick, before the host has
    // reflected the answer — the user would be asked the same thing repeatedly.
    expect(deriveDecisions([s])).toHaveLength(0);
  });

  it("raises nothing for a session that isn't blocked", () => {
    expect(deriveDecisions([session({ pendingDecisions: 0 })])).toHaveLength(0);
    expect(deriveDecisions([session({ pendingToolName: null, pendingToolId: null })])).toHaveLength(0);
  });

  it("marks a dead session's card undeliverable", () => {
    // A transcript with no live pane can still show what it was blocked on, but there
    // is nothing to type into — the UI uses this to disable the answer controls.
    const [d] = deriveDecisions([session({ live: false })]);
    expect(d.body).toMatchObject({ deliverable: false });
  });

  it("dates the card from when the session started waiting", () => {
    const [d] = deriveDecisions([session({ waitingSince: "2026-07-29T09:30:00.000Z" })]);
    expect(d.createdAt).toBe("2026-07-29T09:30:00.000Z");
  });
});
