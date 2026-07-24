import { execFile } from "node:child_process";
import { getSshTarget, isLocalMachine } from "./workspace";
import { sshMuxOpts } from "./ssh-common";

// Read the tail of a session's Claude TUI pane so the renderer can pull out the OAuth
// login URL (and detect success) during a `/login` re-auth flow. The session lives in
// tmux `rcw-<wrapperId>:0` on its host — capture that pane's scrollback over SSH (or
// locally). Best-effort: any failure returns "" so the login modal falls back to a
// manual paste field.

const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

export async function captureClaudePane(machine: string, wrapperId: string): Promise<string> {
  if (!wrapperId) return "";
  const target = `rcw-${wrapperId}:0`;
  const tmuxCmd = `tmux capture-pane -p -t ${shq(target)} -S -400`;
  return new Promise((resolve) => {
    const done = (out: string | null) => resolve(out ?? "");
    try {
      if (isLocalMachine(machine)) {
        execFile("bash", ["-lc", tmuxCmd], { maxBuffer: 4 * 1024 * 1024, timeout: 15000 }, (_e, out) => done(out));
      } else {
        getSshTarget(machine)
          .then((t) => {
            execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=12", ...sshMuxOpts(), ...t.opts, t.host, tmuxCmd],
              { maxBuffer: 4 * 1024 * 1024, timeout: 20000 }, (_e, out) => done(out));
          })
          .catch(() => done(""));
      }
    } catch { done(""); }
  });
}
