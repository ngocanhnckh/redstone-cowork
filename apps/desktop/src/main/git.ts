import { execFile } from "node:child_process";
import { sshMuxOpts } from "./ssh-common";
import { isLocalMachine, getSshHost } from "./workspace";

// Latest commits for a session's repo — runs `git log` either locally or over the
// same multiplexed SSH connection the file browser uses.

const TIMEOUT_MS = 12_000;
const SEP = "\x1f"; // unit separator between fields
const REC = "\x1e"; // record separator between commits

export type Commit = { hash: string; author: string; relative: string; date: string; subject: string };
export type GitInfo = { ok: boolean; repo: boolean; branch: string | null; ahead: number; behind: number; dirty: number; commits: Commit[]; error?: string };

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

function run(machine: string, argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (isLocalMachine(machine)) {
      execFile(argv[0], argv.slice(1), { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout);
      });
    } else {
      const remote = argv.map(shellQuote).join(" ");
      execFile("ssh", [...sshMuxOpts(), "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", getSshHost(machine), remote],
        { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
          if (err) reject(err); else resolve(stdout);
        });
    }
  });
}

/** Read branch, ahead/behind, dirty count and the latest commits for `cwd`'s repo. */
export async function gitInfo(cwd: string, machine: string, limit = 12): Promise<GitInfo> {
  const empty: GitInfo = { ok: false, repo: false, branch: null, ahead: 0, behind: 0, dirty: 0, commits: [] };
  try {
    // Is it a repo at all?
    await run(machine, ["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"]);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || "";
    // Only a genuine non-repo when git itself says so. Anything else (ssh can't
    // resolve/connect, host unreachable, git missing) is a real error to surface —
    // NOT "not a git repository", which was misleading.
    if (/not a git repository/i.test(msg)) return { ...empty, ok: true, repo: false };
    const firstLine = msg.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? msg;
    return { ...empty, ok: false, repo: false, error: firstLine };
  }
  try {
    const fmt = ["%h", "%an", "%cr", "%cI", "%s"].join(SEP) + REC;
    const [logOut, branchOut, statusOut, aheadBehind] = await Promise.all([
      run(machine, ["git", "-C", cwd, "log", `-n${limit}`, `--pretty=format:${fmt}`]),
      run(machine, ["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
      run(machine, ["git", "-C", cwd, "status", "--porcelain"]).catch(() => ""),
      run(machine, ["git", "-C", cwd, "rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(() => ""),
    ]);
    const commits: Commit[] = logOut.split(REC).map((r) => r.trim()).filter(Boolean).map((r) => {
      const [hash, author, relative, date, subject] = r.split(SEP);
      return { hash, author, relative, date, subject };
    });
    const dirty = statusOut.split("\n").filter((l) => l.trim()).length;
    const [behind, ahead] = aheadBehind.trim().split(/\s+/).map((n) => Number(n) || 0);
    return { ok: true, repo: true, branch: branchOut.trim() || null, ahead: ahead || 0, behind: behind || 0, dirty, commits };
  } catch (e) {
    return { ...empty, ok: false, repo: true, error: e instanceof Error ? e.message : String(e) };
  }
}
