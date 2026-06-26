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
): string[][] {
  const session = `rcw-${wrapperId}`;
  const autoMode = args.includes("--enable-auto-mode");
  const envPrefix = autoMode
    ? `RCW_WRAPPER_ID=${wrapperId} RCW_AUTO_MODE=1`
    : `RCW_WRAPPER_ID=${wrapperId}`;
  const claudeCmd = `${envPrefix} claude ${args.map(shq).join(" ")}`;
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

export function runWrapper(args: string[], mainBin: string): void {
  if (!loadCliConfig()) {
    console.error("run `redstone init --server <url> --token <token>` first");
    exit(1);
  }
  if (spawnSync("tmux", ["-V"], { stdio: "ignore" }).error) {
    console.error("redstone claude requires tmux (on Windows: run inside WSL2). Install tmux and retry.");
    exit(1);
  }
  const wrapperId = randomBytes(4).toString("hex");
  installHooks(process.cwd(), `node ${mainBin}`);
  const cmds = buildTmuxCommands(wrapperId, process.cwd(), args, mainBin);
  for (let i = 0; i < cmds.length - 2; i++) execFileSync("tmux", cmds[i]);
  spawnSync("tmux", cmds[cmds.length - 2], { stdio: "inherit" });
  spawnSync("tmux", cmds[cmds.length - 1], { stdio: "ignore" });
}

// Standalone `redstone-claude` bin (back-compat). The folded `redstone claude`
// path in main.ts is what the installed bundle uses.
if (require.main === module) {
  const wrapperBin = realpathSync(argv[1]);
  const mainBin = wrapperBin.replace(/claude-wrapper\.js$/, "main.js");
  runWrapper(argv.slice(2), mainBin);
}
