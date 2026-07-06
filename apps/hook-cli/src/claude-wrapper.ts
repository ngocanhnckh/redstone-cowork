#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { argv, exit } from "node:process";
import { loadCliConfig } from "./config";
import { installHooks } from "./installer";

/** Shell-quote a single argument using single-quote escaping. */
export const shq = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;

/**
 * Build the inline `KEY='VALUE' ...` env prefix that precedes `claude` in the
 * tmux command. Auto-mode vars come first, then the named-config env so a
 * profile can override auto-mode. Values are shell-quoted; keys are trusted
 * (validated on `config set`). Returns "" when there is nothing to inject.
 */
export function buildEnvPrefix(
  autoMode: boolean,
  wrapperId: string,
  configEnv?: Record<string, string> | null,
): string {
  const parts = [`RCW_WRAPPER_ID=${wrapperId}`];
  if (autoMode) parts.push("RCW_AUTO_MODE=1");
  if (configEnv) {
    for (const [k, v] of Object.entries(configEnv)) parts.push(`${k}=${shq(v)}`);
  }
  return parts.join(" ");
}

/**
 * Build the list of tmux arg-arrays needed to start a redstone-claude session.
 * Returned in execution order:
 *   [0] new-session (background, sets up RCW_WRAPPER_ID env + claude)
 *   [1] set-option  (status off)
 *   [2] new-window  (hidden poll window)
 *   [3] attach      (foreground — caller executes with spawnSync/inherit)
 *   [4] kill-session (cleanup after attach exits)
 */
export function buildTmuxCommands(
  wrapperId: string,
  cwd: string,
  args: string[],
  mainBin: string,
  configEnv?: Record<string, string> | null,
): string[][] {
  const session = `rcw-${wrapperId}`;
  const autoMode = args.includes("--enable-auto-mode");
  const envPrefix = buildEnvPrefix(autoMode, wrapperId, configEnv);
  const inner = `${envPrefix} claude ${args.map(shq).join(" ")}`;
  // If claude exits non-zero (e.g. a bad ANTHROPIC_* value from a --config profile,
  // or `claude` not on PATH), keep the pane open showing the exit code + a hint,
  // instead of collapsing to the blank poll window — otherwise the failure looks
  // like "an empty terminal". On a normal exit (0) the pane closes as usual.
  const cfgKeys = configEnv ? Object.keys(configEnv).join(", ") : "";
  const hint = cfgKeys ? ` — check the env from your --config profile (${cfgKeys})` : "";
  const claudeCmd =
    `${inner}; rcw_ec=$?; [ $rcw_ec -eq 0 ] || ` +
    `{ echo; echo "redstone: claude exited with status $rcw_ec${hint}"; echo "press Enter to close…"; read _; }`;
  const pollCmd = `node ${mainBin} poll --wrapper ${wrapperId} --tmux ${session}:0`;

  return [
    // 0: create session in background with claude running
    ["new-session", "-d", "-s", session, "-c", cwd, claudeCmd],
    // 1: hide the status bar
    ["set-option", "-t", session, "status", "off"],
    // 2: hidden poll window
    ["new-window", "-d", "-t", session, pollCmd],
    // 3: attach to the claude window (foreground)
    ["attach", "-t", `${session}:0`],
    // 4: clean up when the user exits
    ["kill-session", "-t", session],
  ];
}

export async function runWrapper(args: string[], mainBin: string, configName?: string): Promise<void> {
  const cfg = loadCliConfig();
  if (!cfg) {
    console.error("run `redstone init --server <url> --token <token>` first");
    exit(1);
  }
  if (spawnSync("tmux", ["-V"], { stdio: "ignore" }).error) {
    console.error("redstone claude requires tmux (on Windows: run inside WSL2). Install tmux and retry.");
    exit(1);
  }

  // Fetch the named config profile's env, if requested. Fail-safe: a bad/unknown
  // profile prints a warning and continues WITHOUT env — never blocks the session.
  let configEnv: Record<string, string> | null = null;
  if (configName) {
    try {
      const { ApiClient } = await import("./api-client");
      const profile = await new ApiClient(cfg).getConfig(configName);
      if (profile) configEnv = profile.env;
      else console.error(`redstone: config profile "${configName}" not found — continuing without its env`);
    } catch {
      console.error(`redstone: could not fetch config "${configName}" — continuing without its env`);
    }
  }

  const wrapperId = randomBytes(4).toString("hex");
  installHooks(process.cwd(), `node ${mainBin}`);
  const cmds = buildTmuxCommands(wrapperId, process.cwd(), args, mainBin, configEnv);
  for (let i = 0; i < cmds.length - 2; i++) execFileSync("tmux", cmds[i]);
  spawnSync("tmux", cmds[cmds.length - 2], { stdio: "inherit" });
  spawnSync("tmux", cmds[cmds.length - 1], { stdio: "ignore" });
}

// Standalone `redstone-claude` bin (back-compat). The folded `redstone claude`
// path in main.ts is what the installed bundle uses.
if (require.main === module) {
  const wrapperBin = realpathSync(argv[1]);
  const mainBin = wrapperBin.replace(/claude-wrapper\.js$/, "main.js");
  runWrapper(argv.slice(2), mainBin).catch(() => exit(0));
}
