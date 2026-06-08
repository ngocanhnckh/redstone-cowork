import { describe, it, expect } from "vitest";
import { DecisionSchema, NewDecisionSchema, ResolutionSchema } from "../src/decisions/decision";
import { AgentSessionSchema, NewAgentSessionSchema } from "../src/sessions/agent-session";

describe("Decision schemas", () => {
  it("accepts a new permission decision", () => {
    const d = NewDecisionSchema.parse({
      sessionId: "s1", kind: "permission", title: "Bash: rm -rf build",
      body: { tool_name: "Bash" }, options: [{ label: "Allow" }, { label: "Deny" }],
    });
    expect(d.options).toHaveLength(2);
  });
  it("rejects unknown kind", () => {
    expect(() => NewDecisionSchema.parse({ sessionId: "s", kind: "nope", title: "t" })).toThrow();
  });
  it("parses a resolution with answers", () => {
    const r = ResolutionSchema.parse({ choice: "Allow", answers: { Q: "A" }, custom: null });
    expect(r.choice).toBe("Allow");
  });
  it("parses full decision with dates", () => {
    const d = DecisionSchema.parse({
      id: "9f3b8c1e-2a4d-4f6a-9c0d-1e2f3a4b5c6d", sessionId: "s1", kind: "question",
      title: "t", body: {}, options: [], status: "pending",
      createdAt: "2026-06-07T10:00:00Z", resolvedAt: null, resolution: null,
    });
    expect(d.createdAt).toBeInstanceOf(Date);
  });
  it("parses agent session", () => {
    const s = AgentSessionSchema.parse({
      id: "abc", machine: "devbox", cwd: "/home/u/p", gitBranch: null,
      attachedAt: "2026-06-07T10:00:00Z", lastSeenAt: "2026-06-07T10:01:00Z",
    });
    expect(s.lastSeenAt.getTime()).toBeGreaterThan(s.attachedAt.getTime());
  });
  it("accepts instruction kind and deliveredAt", () => {
    const d = DecisionSchema.parse({
      id: "9f3b8c1e-2a4d-4f6a-9c0d-1e2f3a4b5c6d", sessionId: "s", kind: "instruction",
      title: "run tests", body: {}, options: [], status: "resolved",
      createdAt: "2026-06-07T10:00:00Z", resolvedAt: "2026-06-07T10:00:01Z",
      resolution: { choice: null, answers: null, custom: "pnpm test" }, deliveredAt: null,
    });
    expect(d.deliveredAt).toBeNull();
  });
  it("agent session carries optional wrapperId", () => {
    const s = NewAgentSessionSchema.parse({ id: "x", machine: "m", cwd: "/p", gitBranch: null, wrapperId: "ab12" });
    expect(s.wrapperId).toBe("ab12");
  });
  it("agent session parses permissionMode and autoModeEnabled with defaults", () => {
    const full = AgentSessionSchema.parse({
      id: "abc", machine: "devbox", cwd: "/home/u/p", gitBranch: null,
      attachedAt: "2026-06-07T10:00:00Z", lastSeenAt: "2026-06-07T10:01:00Z",
      permissionMode: "plan", autoModeEnabled: true,
    });
    expect(full.permissionMode).toBe("plan");
    expect(full.autoModeEnabled).toBe(true);
  });
  it("agent session defaults permissionMode to null and autoModeEnabled to false", () => {
    const s = AgentSessionSchema.parse({
      id: "abc", machine: "devbox", cwd: "/home/u/p", gitBranch: null,
      attachedAt: "2026-06-07T10:00:00Z", lastSeenAt: "2026-06-07T10:01:00Z",
    });
    expect(s.permissionMode).toBeNull();
    expect(s.autoModeEnabled).toBe(false);
  });
  it("NewAgentSession accepts permissionMode and autoModeEnabled optionally", () => {
    const s = NewAgentSessionSchema.parse({ id: "x", machine: "m", cwd: "/p", permissionMode: "plan", autoModeEnabled: true });
    expect(s.permissionMode).toBe("plan");
    expect(s.autoModeEnabled).toBe(true);
    const s2 = NewAgentSessionSchema.parse({ id: "x", machine: "m", cwd: "/p" });
    expect(s2.permissionMode).toBeNull();
    expect(s2.autoModeEnabled).toBe(false);
  });
  it("mode kind decision parses", () => {
    const d = DecisionSchema.parse({
      id: "9f3b8c1e-2a4d-4f6a-9c0d-1e2f3a4b5c6d", sessionId: "s", kind: "mode",
      title: "Switch to plan mode", body: { btabs: 2, target: "plan" }, options: [], status: "resolved",
      createdAt: "2026-06-07T10:00:00Z", resolvedAt: "2026-06-07T10:00:01Z",
      resolution: { choice: null, answers: null, custom: null }, deliveredAt: null,
    });
    expect(d.kind).toBe("mode");
  });
});
