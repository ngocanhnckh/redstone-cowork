import type { IPty } from "node-pty";
import { spawn } from "node:child_process";

// Auto-install redstone onto a server over SSH from the user's machine. Tries key auth
// first (fail-fast so we can prompt); with a password, drives ssh through a PTY and feeds
// the password at the prompt. Output is streamed back for a live install log.

let ptyModule: typeof import("node-pty") | null = null;
function loadPty(): typeof import("node-pty") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  if (!ptyModule) ptyModule = require("node-pty") as typeof import("node-pty");
  return ptyModule;
}

export type InstallArgs = { host: string; sshUser: string; sshPort: number; command: string; password?: string; extraOpts?: string[]; successMarker?: string };
export type InstallResult = { ok: boolean; authFailed?: boolean; output: string; error?: string };

const shSingle = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Build the remote command that actually STARTS a redstone-claude session — the same
 *  background steps `redstone claude` performs (create a detached `rcw-<id>` tmux with
 *  claude + a hidden poll window that reports to the cockpit), minus the interactive
 *  attach + kill-session the wrapper does when a human is at the terminal. The folder is
 *  pre-trusted in ~/.claude.json so claude doesn't block on the first-run trust prompt
 *  (where the session would be invisible to the cockpit). Base64-wrapped so no quoting of
 *  the folder path can break the shell. Prints `RCW_STARTED <session>` on success. */
export function buildLaunchCommand(opts: { folder: string; danger: boolean; resumeId?: string }): string {
  const resume = opts.resumeId ? `--resume ${opts.resumeId.replace(/[^a-zA-Z0-9-]/g, "")} ` : "";
  const flags = `${resume}${opts.danger ? "--dangerously-skip-permissions" : ""}`.trim();
  const script = [
    `set -e`,
    // Put the host's private Node/tmux/Claude (provisioned under ~/.redstone by install.sh,
    // no sudo) on PATH before anything runs — otherwise `node`/`tmux`/`claude` may be absent
    // on a box that never had them system-wide.
    `[ -f "$HOME/.redstone/env" ] && . "$HOME/.redstone/env"`,
    // Self-update the host's agent bundle BEFORE starting the poller, so every new session picks
    // up the latest fixes automatically (e.g. the bracketed-paste message delivery) — no manual
    // 'redstone update'. Best-effort: never let a failed/offline update block the launch.
    `node "$HOME/.redstone/redstone.js" update >/dev/null 2>&1 || true`,
    `FOLDER=${shSingle(opts.folder)}`,
    `mkdir -p "$FOLDER"`,
    // Pre-accept the folder-trust prompt (same effect as choosing "Yes, I trust this folder").
    `python3 -c 'import json,os,sys; p=os.path.expanduser("~/.claude.json"); d=(json.load(open(p)) if os.path.exists(p) else {}); d.setdefault("projects",{}).setdefault(sys.argv[1],{})["hasTrustDialogAccepted"]=True; json.dump(d,open(p,"w"))' "$FOLDER" >/dev/null 2>&1 || true`,
    `cd "$FOLDER"`,
    `command -v redstone >/dev/null 2>&1 || { echo "RCW_ERR redstone not installed on this server"; exit 3; }`,
    `command -v tmux >/dev/null 2>&1 || { echo "RCW_ERR tmux not installed on this server"; exit 3; }`,
    `redstone hook >/dev/null 2>&1 || true`,
    `ID=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \\n')`,
    `S="rcw-$ID"`,
    `BIN="$HOME/.redstone/redstone.js"`,
    `CLAUDECMD="RCW_WRAPPER_ID=$ID claude ${flags}; rcw_ec=\\$?; [ \\$rcw_ec -eq 0 ] || { echo; echo 'redstone: claude exited '\\$rcw_ec; echo 'press Enter to close'; read _; }"`,
    `tmux new-session -d -s "$S" -c "$FOLDER" "$CLAUDECMD"`,
    `tmux set-option -t "$S" status off`,
    `tmux new-window -d -t "$S" "node $BIN poll --wrapper $ID --tmux $S:0"`,
    `echo "RCW_STARTED $S"`,
  ].join("\n");
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return `echo ${b64} | base64 -d | bash -l`;
}

const baseOpts = (port: number) => ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15", "-p", String(port || 22)];

/** The ssh destination. With a user → `user@host`; with a BLANK user → the bare host, so
 *  ssh resolves User/HostName/Port from the operator's ~/.ssh/config (the whole point of
 *  letting a host be added by its config alias). */
const sshDest = (sshUser: string, host: string): string => (sshUser && sshUser.trim() ? `${sshUser.trim()}@${host}` : host);

/** Read the reporting agent's stable host-id (~/.redstone/host-id) over a DIRECT ssh to
 *  sshUser@host — the same reachable path install uses. Returns the trimmed UUID, or null
 *  if the host can't be reached this way or isn't installed. Used to NAT-proof-link a
 *  curated server to its inventory host (a closed host's public ip/hostname won't match). */
export function sshReadHostId(args: { host: string; sshUser: string; sshPort: number; password?: string; extraOpts?: string[] }): Promise<string | null> {
  const { host, sshUser, sshPort, password, extraOpts = [] } = args;
  return new Promise((resolve) => {
    let out = "";
    const okId = () => { const m = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); return m ? m[0] : null; };
    if (!password) {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn("ssh", ["-o", "BatchMode=yes", ...extraOpts, ...baseOpts(sshPort), sshDest(sshUser, host), "cat ~/.redstone/host-id 2>/dev/null"]);
      } catch { return resolve(null); }
      child.stdout?.on("data", (b: Buffer) => { out += b.toString(); });
      child.on("error", () => resolve(null));
      child.on("close", () => resolve(okId()));
      setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve(okId()); }, 20000);
      return;
    }
    let term: IPty;
    try {
      term = loadPty().spawn("ssh", ["-tt", "-o", "NumberOfPasswordPrompts=2", ...extraOpts, ...baseOpts(sshPort), sshDest(sshUser, host), "cat ~/.redstone/host-id 2>/dev/null"], {
        name: "xterm-256color", cols: 80, rows: 24, cwd: process.env.HOME, env: process.env as Record<string, string>,
      });
    } catch { return resolve(null); }
    let pwSent = 0, done = false;
    const finish = () => { if (done) return; done = true; try { term.kill(); } catch { /* ignore */ } resolve(okId()); };
    term.onData((d) => { out += d; const p = (out.match(/assword:/gi) || []).length; if (p > pwSent) { pwSent = p; term.write(password + "\r"); } if (okId()) finish(); });
    term.onExit(() => finish());
    setTimeout(finish, 20000);
  });
}

/** Run the install command on `sshUser@host`. Without a password → key-only (fast fail on
 *  auth → authFailed=true). With a password → PTY + auto-answer the password prompt. */
export function sshInstall(args: InstallArgs, onData: (s: string) => void): Promise<InstallResult> {
  const { host, sshUser, sshPort, command, password, extraOpts = [], successMarker } = args;
  const target = sshDest(sshUser, host);

  if (!password) {
    // Stream (not execFile/buffer) so we can resolve the instant the remote command prints
    // its success marker. Installs start a background agent that inherits the SSH channel's
    // fds and keeps it open — without marker detection ssh would hang until the timeout even
    // though the install already finished.
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn("ssh", ["-o", "BatchMode=yes", ...extraOpts, ...baseOpts(sshPort), target, command]);
      } catch (e) {
        return resolve({ ok: false, output: "", error: e instanceof Error ? e.message : String(e) });
      }
      let output = "", stderr = "", done = false;
      const finish = (r: InstallResult) => { if (done) return; done = true; try { child.kill(); } catch { /* ignore */ } resolve(r); };
      const onChunk = (buf: Buffer) => {
        const s = buf.toString();
        output += s;
        onData(s);
        if (successMarker && output.includes(successMarker)) finish({ ok: true, output });
      };
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); onChunk(b); });
      child.on("error", (e) => finish({ ok: false, output, error: e.message }));
      child.on("close", (code) => {
        if (code === 0) return finish({ ok: true, output });
        const authFailed = /permission denied|no more authentication methods|publickey|password/i.test(stderr)
          || code === 255;
        finish({ ok: false, authFailed, output, error: `ssh exited with status ${code}` });
      });
      setTimeout(() => finish({ ok: false, output, error: "install timed out (240s)" }), 240000);
    });
  }

  return new Promise((resolve) => {
    let term: IPty;
    try {
      term = loadPty().spawn("ssh", ["-tt", "-o", "NumberOfPasswordPrompts=2", ...extraOpts, ...baseOpts(sshPort), target, command], {
        name: "xterm-256color", cols: 110, rows: 40, cwd: process.env.HOME, env: process.env as Record<string, string>,
      });
    } catch (e) {
      return resolve({ ok: false, output: "", error: e instanceof Error ? e.message : String(e) });
    }
    let output = "", pwSent = 0, done = false;
    const finish = (r: InstallResult) => { if (done) return; done = true; try { term.kill(); } catch { /* ignore */ } resolve(r); };
    term.onData((d) => {
      output += d;
      // Mask the password echo defensively (SSH shouldn't echo, but be safe).
      onData(d);
      // Answer up to 2 password prompts (in case the first newline lands early).
      const prompts = (output.match(/assword:/gi) || []).length;
      if (prompts > pwSent) { pwSent = prompts; term.write(password + "\r"); }
      // Resolve the instant the remote command reports success — a started background agent
      // can hold the PTY open past command completion, which would otherwise hang to timeout.
      if (successMarker && output.includes(successMarker)) finish({ ok: true, output });
    });
    term.onExit(({ exitCode }) => {
      const authFailed = exitCode !== 0 && /permission denied|authentication failed/i.test(output);
      finish({ ok: exitCode === 0, authFailed, output, error: exitCode === 0 ? undefined : `ssh exited with status ${exitCode}` });
    });
    setTimeout(() => finish({ ok: false, output, error: "install timed out (240s)" }), 240000);
  });
}
