import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "Notification",
  "PermissionRequest",
  "PostToolUse",
  "SessionEnd",
] as const;

const HOOK_TIMEOUT_S = 10;

// PreToolUse is registered ONLY for AskUserQuestion (via a matcher) — so it fires
// just for genuine questions, not every tool call. This is how a question surfaces
// as an answerable card in bypassPermissions / auto mode, where PermissionRequest
// never fires (permissions are auto-granted) and AskUserQuestion would otherwise
// produce only a generic Notification with no answer interface.
const MATCHED_HOOKS: { event: string; matcher: string }[] = [
  { event: "PreToolUse", matcher: "AskUserQuestion" },
];

type HookEntry = { type: "command"; command: string; timeout?: number };
type Matcher = { matcher?: string; hooks: HookEntry[] };

export function installHooks(projectDir: string, binPath: string) {
  const settingsPath = join(projectDir, ".claude", "settings.local.json");
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  settings.hooks = settings.hooks ?? {};
  const command = `${binPath} handle`;
  for (const event of HOOK_EVENTS) {
    const matchers: Matcher[] = settings.hooks[event] ?? [];
    const already = matchers.some((m) => m.hooks?.some((h) => h.command === command));
    if (!already) {
      matchers.push({ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] });
      settings.hooks[event] = matchers;
    }
  }
  for (const { event, matcher } of MATCHED_HOOKS) {
    const matchers: Matcher[] = settings.hooks[event] ?? [];
    const already = matchers.some((m) => m.matcher === matcher && m.hooks?.some((h) => h.command === command));
    if (!already) {
      matchers.push({ matcher, hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] });
      settings.hooks[event] = matchers;
    }
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return settingsPath;
}
