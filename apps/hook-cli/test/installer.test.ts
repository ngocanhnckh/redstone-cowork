import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHooks, HOOK_EVENTS } from "../src/installer";
import { armAttach, isArmed, disarm } from "../src/state";

describe("installer", () => {
  it("writes hooks for all events into empty settings.local.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    installHooks(dir, "/usr/local/bin/redstone");
    const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    for (const ev of HOOK_EVENTS) expect(settings.hooks[ev]).toBeDefined();
    expect(JSON.stringify(settings)).toContain("/usr/local/bin/redstone handle");
  });

  it("merges without clobbering existing settings/hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude/settings.local.json"), JSON.stringify({
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool" }] }] },
    }));
    installHooks(dir, "/bin/redstone");
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    expect(s.permissions.allow).toContain("Bash(ls:*)");
    expect(JSON.stringify(s.hooks.Stop)).toContain("other-tool");
    expect(JSON.stringify(s.hooks.Stop)).toContain("/bin/redstone handle");
  });

  it("is idempotent (no duplicate hook entries)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    installHooks(dir, "/bin/redstone");
    installHooks(dir, "/bin/redstone");
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    expect(s.hooks.Stop.flatMap((m: { hooks: unknown[] }) => m.hooks)).toHaveLength(1);
  });

  it("installs exactly 7 hook events (includes PostToolUse)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    installHooks(dir, "/bin/redstone");
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    expect(HOOK_EVENTS).toHaveLength(7);
    expect(HOOK_EVENTS).toContain("PostToolUse");
    // 7 unmatched events + PreToolUse (matched to AskUserQuestion) = 8 hook keys.
    expect(Object.keys(s.hooks)).toHaveLength(8);
    const pre = s.hooks.PreToolUse;
    expect(pre).toBeDefined();
    expect(pre[0].matcher).toBe("AskUserQuestion");
  });

  it("uses HOOK_TIMEOUT_S = 10", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    installHooks(dir, "/bin/redstone");
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    const stopHooks = s.hooks.Stop.flatMap((m: { hooks: Array<{ timeout?: number }> }) => m.hooks);
    expect(stopHooks[0].timeout).toBe(10);
  });
});

describe("arming", () => {
  it("arm/disarm round-trip with TTL", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rcw-state-"));
    armAttach("/some/project", stateDir);
    expect(isArmed("/some/project", stateDir)).toBe(true);
    disarm("/some/project", stateDir);
    expect(isArmed("/some/project", stateDir)).toBe(false);
  });
});
