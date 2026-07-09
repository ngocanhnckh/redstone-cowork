import { describe, it, expect, vi } from "vitest";
import { processEvent, type Deps } from "../src/handler";

const makeApi = (overrides: Partial<Deps["api"]> = {}): Deps["api"] => ({
  heartbeat: vi.fn().mockResolvedValue(true),
  attach: vi.fn().mockResolvedValue(undefined),
  createDecision: vi.fn().mockResolvedValue({ id: "d1" }),
  resolveLocal: vi.fn().mockResolvedValue(undefined),
  pushState: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const baseDeps = (overrides: Partial<Deps> = {}): Deps => ({
  api: makeApi(),
  isArmed: vi.fn().mockReturnValue(false),
  disarm: vi.fn(),
  machine: "testbox",
  wrapperId: null,
  autoModeEnabled: false,
  lastAssistantText: vi.fn().mockReturnValue(null),
  recentMessages: vi.fn().mockReturnValue([]),
  latestTodos: vi.fn().mockReturnValue([]),
  latestUsage: vi.fn().mockReturnValue({ contextTokens: null, model: null }),
  totalUsage: vi.fn().mockReturnValue({ tokensInput: 0, tokensOutput: 0 }),
  ...overrides,
});

const ev = (name: string, extra: object = {}) =>
  ({ hook_event_name: name, session_id: "s1", cwd: "/p", ...extra });

describe("processEvent", () => {
  it("unattached + unarmed + no wrapper → no-op, no attach", async () => {
    const deps = baseDeps({
      api: makeApi({ heartbeat: vi.fn().mockResolvedValue(false) }),
      isArmed: vi.fn().mockReturnValue(false),
      wrapperId: null,
    });
    const out = await processEvent(ev("UserPromptSubmit"), deps);
    expect(out).toBeNull();
    expect(deps.api.attach).not.toHaveBeenCalled();
  });

  it("unattached + armed → attaches and disarms", async () => {
    const api = makeApi({ heartbeat: vi.fn().mockResolvedValue(false) });
    const deps = baseDeps({
      api,
      isArmed: vi.fn().mockReturnValue(true),
      wrapperId: null,
    });
    await processEvent(ev("UserPromptSubmit"), deps);
    expect(deps.api.attach).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", cwd: "/p" })
    );
    expect(deps.disarm).toHaveBeenCalled();
  });

  it("unattached + wrapperId set → attaches WITHOUT arming (attach payload contains wrapperId)", async () => {
    const api = makeApi({ heartbeat: vi.fn().mockResolvedValue(false) });
    const disarm = vi.fn();
    const deps = baseDeps({
      api,
      isArmed: vi.fn().mockReturnValue(false),
      disarm,
      wrapperId: "wrap-abc",
    });
    await processEvent(ev("UserPromptSubmit"), deps);
    expect(deps.api.attach).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", wrapperId: "wrap-abc" })
    );
    // disarm should NOT be called since we didn't use arming
    expect(disarm).not.toHaveBeenCalled();
  });

  it("known wrapper session still re-attaches to refresh the wrapper link (--continue fix)", async () => {
    // heartbeat would say "known", but a resumed session may point at a dead wrapper.
    const api = makeApi({ heartbeat: vi.fn().mockResolvedValue(true) });
    const deps = baseDeps({ api, wrapperId: "new-wrap" });
    await processEvent(ev("UserPromptSubmit"), deps);
    expect(deps.api.attach).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", wrapperId: "new-wrap" })
    );
  });

  it("attached Stop → createDecision kind completion, returns null", async () => {
    const deps = baseDeps();
    const out = await processEvent(ev("Stop"), deps);
    expect(deps.api.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "completion" })
    );
    expect(out).toBeNull();
  });

  it("attaches the latest assistant prose as body.lastMessage on a permission card", async () => {
    const deps = baseDeps({
      wrapperId: "wrap1",
      lastAssistantText: vi.fn().mockReturnValue("I'm about to install deps, ok?"),
    });
    await processEvent(
      ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm install" } }),
      deps
    );
    expect(deps.api.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ lastMessage: "I'm about to install deps, ok?" }),
      })
    );
  });

  it("PreToolUse AskUserQuestion → creates a question decision (works in bypass mode)", async () => {
    const deps = baseDeps({ wrapperId: "wrap1" });
    const out = await processEvent(
      ev("PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [
        { question: "Ship now or bundle?", options: [{ label: "Ship now" }, { label: "Bundle" }] },
      ] } }),
      deps
    );
    expect(deps.api.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "question", title: "Ship now or bundle?", options: [{ label: "Ship now" }, { label: "Bundle" }] })
    );
    expect(out).toBeNull();
  });

  it("PreToolUse for a non-AskUserQuestion tool → no decision", async () => {
    const deps = baseDeps({ wrapperId: "wrap1" });
    await processEvent(ev("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }), deps);
    expect(deps.api.createDecision).not.toHaveBeenCalled();
  });

  it("PermissionRequest for AskUserQuestion → skipped (handled on PreToolUse, no duplicate)", async () => {
    const deps = baseDeps({ wrapperId: "wrap1" });
    await processEvent(
      ev("PermissionRequest", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "x" }] } }),
      deps
    );
    expect(deps.api.createDecision).not.toHaveBeenCalled();
  });

  it("Notification with message → kind notification", async () => {
    const deps = baseDeps();
    const out = await processEvent(
      ev("Notification", { message: "Claude finished" }),
      deps
    );
    expect(deps.api.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "notification", title: "Claude finished" })
    );
    expect(out).toBeNull();
  });

  it("PostToolUse → resolveLocal called, returns null", async () => {
    const deps = baseDeps();
    const out = await processEvent(ev("PostToolUse", { tool_name: "Bash" }), deps);
    expect(deps.api.resolveLocal).toHaveBeenCalledWith("s1", "Bash");
    expect(out).toBeNull();
  });

  it("PostToolUse → pushState streams progress while Claude works", async () => {
    const deps = baseDeps();
    await processEvent(ev("PostToolUse"), deps);
    expect(deps.api.pushState).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ transcript: expect.anything() })
    );
  });

  it("refreshes todos only when a task/todo tool ran or on SessionStart", async () => {
    // SessionStart → includes todos
    const d1 = baseDeps({ api: makeApi() });
    await processEvent(ev("SessionStart"), d1);
    expect(d1.api.pushState).toHaveBeenCalledWith("s1", expect.objectContaining({ todos: expect.anything() }));

    // PostToolUse for a non-task tool → NO todos key (avoids a full-transcript scan)
    const d2 = baseDeps({ api: makeApi() });
    await processEvent(ev("PostToolUse", { tool_name: "Bash" }), d2);
    expect((d2.api.pushState as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty("todos");

    // PostToolUse for TaskUpdate → includes todos
    const d3 = baseDeps({ api: makeApi() });
    await processEvent(ev("PostToolUse", { tool_name: "TaskUpdate" }), d3);
    expect(d3.api.pushState).toHaveBeenCalledWith("s1", expect.objectContaining({ todos: expect.anything() }));
  });

  it("UserPromptSubmit and PostToolUse push working=true (Claude is mid-turn)", async () => {
    for (const name of ["UserPromptSubmit", "PostToolUse"]) {
      const deps = baseDeps();
      await processEvent(ev(name), deps);
      expect(deps.api.pushState).toHaveBeenCalledWith("s1", expect.objectContaining({ working: true }));
    }
  });

  it("Stop / Notification / PermissionRequest push working=false (waiting on the user)", async () => {
    for (const name of ["Stop", "Notification", "PermissionRequest"]) {
      const deps = baseDeps({ wrapperId: "wrap1" });
      await processEvent(ev(name, { message: "m", tool_name: "Bash", tool_input: { command: "ls" } }), deps);
      expect(deps.api.pushState).toHaveBeenCalledWith("s1", expect.objectContaining({ working: false }));
    }
  });

  it("PermissionRequest → createDecision called AND returns null immediately (non-blocking)", async () => {
    const deps = baseDeps({ wrapperId: "wrap1" });
    const out = await processEvent(
      ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } }),
      deps
    );
    expect(deps.api.createDecision).toHaveBeenCalled();
    // Verify no awaitResolution method exists on deps.api
    expect((deps.api as Record<string, unknown>)["awaitResolution"]).toBeUndefined();
    expect(out).toBeNull();
  });

  it("api down (heartbeat rejects) → resolves null, never throws", async () => {
    const api = makeApi({ heartbeat: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) });
    const deps = baseDeps({ api });
    await expect(processEvent(ev("Stop"), deps)).resolves.toBeNull();
  });

  it("PermissionRequest createDecision rejection → silent null", async () => {
    const api = makeApi({ createDecision: vi.fn().mockRejectedValue(new Error("boom")) });
    const deps = baseDeps({ api, wrapperId: "wrap1" });
    const out = await processEvent(
      ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } }),
      deps
    );
    expect(deps.api.createDecision).toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it("Notification with empty message → no decision created", async () => {
    const deps = baseDeps();
    const out = await processEvent(
      ev("Notification", { message: "" }),
      deps
    );
    expect(deps.api.createDecision).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it("event with permission_mode + autoModeEnabled=true → attach carries both", async () => {
    const api = makeApi();
    const deps = baseDeps({ api, wrapperId: "wrap-mode", autoModeEnabled: true });
    await processEvent(ev("UserPromptSubmit", { permission_mode: "plan" }), deps);
    expect(deps.api.attach).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "plan", autoModeEnabled: true })
    );
  });

  it("event without permission_mode → attach carries permissionMode: null", async () => {
    const api = makeApi();
    const deps = baseDeps({ api, wrapperId: "wrap-nomode", autoModeEnabled: false });
    await processEvent(ev("UserPromptSubmit"), deps);
    expect(deps.api.attach).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: null, autoModeEnabled: false })
    );
  });

  it("armed path also sends permissionMode + autoModeEnabled on attach", async () => {
    const api = makeApi({ heartbeat: vi.fn().mockResolvedValue(false) });
    const deps = baseDeps({
      api,
      isArmed: vi.fn().mockReturnValue(true),
      wrapperId: null,
      autoModeEnabled: true,
    });
    await processEvent(ev("UserPromptSubmit", { permission_mode: "acceptEdits" }), deps);
    expect(deps.api.attach).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "acceptEdits", autoModeEnabled: true })
    );
  });
});
