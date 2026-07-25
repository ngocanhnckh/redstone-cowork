import { execFile } from "node:child_process";
import { getSshTarget, isLocalMachine } from "./workspace";
import { sshMuxOpts } from "./ssh-common";

// Read the tail of a session's Claude TUI pane so the renderer can pull out the OAuth
// login URL (and detect success) during a `/login` re-auth flow. The session lives in
// tmux `rcw-<wrapperId>:0` on its host — capture that pane's scrollback over SSH (or
// locally). Best-effort: any failure returns "" so the login modal falls back to a
// manual paste field.

const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

export function runRemote(machine: string, cmd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const done = (out: string | null) => resolve(out ?? "");
    try {
      if (isLocalMachine(machine)) {
        execFile("bash", ["-lc", cmd], { maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs }, (_e, out) => done(out));
      } else {
        getSshTarget(machine)
          .then((t) => execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=12", ...sshMuxOpts(), ...t.opts, t.host, cmd],
            { maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs }, (_e, out) => done(out)))
          .catch(() => done(""));
      }
    } catch { done(""); }
  });
}

/** Send keystrokes straight into the session's Claude TUI pane via `tmux send-keys`.
 *  `text` is sent literally (`-l`), then an optional Enter — used to drive `/login`, to
 *  confirm the "Claude account with subscription" menu (Enter with no text), and to paste
 *  the code back. Direct so it works even if the delivery poller is wedged. */
export async function sendClaudeKeys(machine: string, wrapperId: string, opts: { text?: string; enter?: boolean }): Promise<boolean> {
  if (!wrapperId) return false;
  const target = `rcw-${wrapperId}:0`;
  const parts: string[] = [];
  if (opts.text) parts.push(`tmux send-keys -t ${shq(target)} -l -- ${shq(opts.text)}`);
  if (opts.enter) parts.push(`tmux send-keys -t ${shq(target)} Enter`);
  if (!parts.length) return false;
  const out = await runRemote(machine, parts.join(" && "), 15000);
  return out !== null;
}

export async function captureClaudePane(machine: string, wrapperId: string): Promise<string> {
  if (!wrapperId) return "";
  const target = `rcw-${wrapperId}:0`;
  return runRemote(machine, `tmux capture-pane -p -J -t ${shq(target)} -S -400`, 20000);
}
