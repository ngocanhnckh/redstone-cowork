import type { IPty } from "node-pty";
import { execFile } from "node:child_process";

// Auto-install redstone onto a server over SSH from the user's machine. Tries key auth
// first (fail-fast so we can prompt); with a password, drives ssh through a PTY and feeds
// the password at the prompt. Output is streamed back for a live install log.

let ptyModule: typeof import("node-pty") | null = null;
function loadPty(): typeof import("node-pty") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  if (!ptyModule) ptyModule = require("node-pty") as typeof import("node-pty");
  return ptyModule;
}

export type InstallArgs = { host: string; sshUser: string; sshPort: number; command: string; password?: string };
export type InstallResult = { ok: boolean; authFailed?: boolean; output: string; error?: string };

const baseOpts = (port: number) => ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15", "-p", String(port || 22)];

/** Run the install command on `sshUser@host`. Without a password → key-only (fast fail on
 *  auth → authFailed=true). With a password → PTY + auto-answer the password prompt. */
export function sshInstall(args: InstallArgs, onData: (s: string) => void): Promise<InstallResult> {
  const { host, sshUser, sshPort, command, password } = args;
  const target = `${sshUser}@${host}`;

  if (!password) {
    return new Promise((resolve) => {
      execFile(
        "ssh",
        ["-o", "BatchMode=yes", ...baseOpts(sshPort), target, command],
        { maxBuffer: 8 * 1024 * 1024, timeout: 240000 },
        (err, stdout, stderr) => {
          const output = (stdout || "") + (stderr || "");
          if (output) onData(output);
          if (!err) return resolve({ ok: true, output });
          const authFailed = /permission denied|no more authentication methods|publickey|password/i.test(stderr || "")
            || (err as NodeJS.ErrnoException & { code?: number }).code === 255;
          resolve({ ok: false, authFailed, output, error: err.message });
        },
      );
    });
  }

  return new Promise((resolve) => {
    let term: IPty;
    try {
      term = loadPty().spawn("ssh", ["-tt", "-o", "NumberOfPasswordPrompts=2", ...baseOpts(sshPort), target, command], {
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
    });
    term.onExit(({ exitCode }) => {
      const authFailed = exitCode !== 0 && /permission denied|authentication failed/i.test(output);
      finish({ ok: exitCode === 0, authFailed, output, error: exitCode === 0 ? undefined : `ssh exited with status ${exitCode}` });
    });
    setTimeout(() => finish({ ok: false, output, error: "install timed out (240s)" }), 240000);
  });
}
