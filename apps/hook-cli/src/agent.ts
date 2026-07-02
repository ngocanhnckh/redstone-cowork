import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { hostname, userInfo, platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { configDir } from "./config";
import { scanSessions } from "./scanner";
import { readRecentMessages } from "./transcript";
import type { ApiClient } from "./api-client";

const execFileP = promisify(execFile);

const SCAN_INTERVAL_MS = 60_000;
const COMMAND_POLL_MS = 25_000;

/** Stable per-machine id, persisted so a host keeps its identity across restarts. */
export function loadOrCreateHostId(): string {
  const path = join(configDir(), "host-id");
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  } catch { /* not created yet */ }
  const id = randomUUID();
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(path, id, { mode: 0o600 });
  } catch { /* best-effort; a fresh id each run is still functional */ }
  return id;
}

type HostCommand = { id: string; kind: string; payload: { sessionId?: string; cwd?: string; message?: string } };

/** Locate a session's transcript file from its cwd (project slug) + id. */
function transcriptPath(cwd: string, sessionId: string): string {
  const slug = cwd.replace(/\//g, "-");
  return join(process.env.HOME ?? "", ".claude", "projects", slug, `${sessionId}.jsonl`);
}

/**
 * Execute one host command and return the result object to post back. Defensive:
 * any failure becomes an `{ ok: false, error }` result rather than throwing.
 */
export async function runCommand(cmd: HostCommand): Promise<Record<string, unknown>> {
  try {
    if (cmd.kind === "passive_run") {
      const { sessionId, cwd, message } = cmd.payload;
      if (!sessionId || !cwd || !message) return { ok: false, error: "missing sessionId/cwd/message" };
      // Headless one-shot: resume the session, print a single reply, no prompts.
      const { stdout } = await execFileP(
        "claude",
        ["--resume", sessionId, "-p", message, "--permission-mode", "bypassPermissions"],
        { cwd, timeout: 110_000, maxBuffer: 8 * 1024 * 1024 }
      );
      return { ok: true, reply: stdout.trim() };
    }
    if (cmd.kind === "fetch_history") {
      const { sessionId, cwd } = cmd.payload;
      if (!sessionId || !cwd) return { ok: false, error: "missing sessionId/cwd" };
      const messages = readRecentMessages(transcriptPath(cwd, sessionId));
      return { ok: true, messages };
    }
    return { ok: false, error: `unknown command kind ${cmd.kind}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The per-host `redstone agent` daemon. Registers the host, then runs two loops:
 * a periodic inventory scan and a command long-poll. Both are fully defensive so
 * a transient error never kills the daemon.
 */
export async function runAgent(opts: { api: ApiClient; sleep?: (ms: number) => Promise<void> }): Promise<void> {
  const { api } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const hostId = loadOrCreateHostId();
  const machine = hostname();
  const user = (() => { try { return userInfo().username; } catch { return null; } })();
  const os = platform();

  await api.registerHost({ hostId, machine, user, os }).catch(() => {});

  // Scan loop: report the full inventory snapshot on an interval.
  const scanLoop = async () => {
    for (;;) {
      try {
        const sessions = scanSessions();
        await api.reportInventory(hostId, { machine, sessions });
      } catch { /* transient — try again next tick */ }
      await sleep(SCAN_INTERVAL_MS);
    }
  };

  // Command loop: long-poll for work, execute, post the result.
  const commandLoop = async () => {
    for (;;) {
      try {
        const cmds = (await api.hostCommands(hostId, COMMAND_POLL_MS)) as HostCommand[];
        for (const cmd of cmds) {
          const result = await runCommand(cmd);
          await api.postCommandResult(hostId, cmd.id, result).catch(() => {});
        }
      } catch {
        await sleep(5_000); // back off on error
      }
    }
  };

  await Promise.all([scanLoop(), commandLoop()]);
}
