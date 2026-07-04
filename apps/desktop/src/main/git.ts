import { execFile } from "node:child_process";
import { sshMuxOpts } from "./ssh-common";
import { isLocalMachine, getSshTarget } from "./workspace";

// Latest commits for a session's repo — runs `git log` either locally or over the
// same multiplexed SSH connection the file browser uses.

const TIMEOUT_MS = 12_000;
const SEP = "\x1f"; // unit separator between fields
const REC = "\x1e"; // record separator between commits

export type Commit = { hash: string; author: string; relative: string; date: string; subject: string };
export type GitInfo = { ok: boolean; repo: boolean; branch: string | null; ahead: number; behind: number; dirty: number; commits: Commit[]; error?: string; remoteUrl?: string | null; webUrl?: string | null };

/**
 * Normalize a git `origin` remote to a browsable https URL when it's a GitHub
 * (or GitHub Enterprise) host; otherwise return null. Handles the ssh
 * (`git@github.com:owner/repo.git`), scp, and https remote forms.
 */
export function githubWebUrl(remote: string): string | null {
  const raw = (remote || "").trim();
  if (!raw) return null;
  let host = "";
  let path = "";
  const scp = raw.match(/^[^@]+@([^:]+):(.+)$/); // git@host:owner/repo(.git)
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const u = new URL(raw);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  if (!/(^|\.)github\.com$|github/i.test(host)) return null; // github.com or *.github enterprise
  const clean = path.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!clean) return null;
  return `https://${host}/${clean}`;
}

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

async function run(machine: string, argv: string[]): Promise<string> {
  if (isLocalMachine(machine)) {
    return new Promise((resolve, reject) => {
      execFile(argv[0], argv.slice(1), { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout);
      });
    });
  }
  const target = await getSshTarget(machine);
  const remote = argv.map(shellQuote).join(" ");
  return new Promise((resolve, reject) => {
    execFile("ssh", [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", target.host, remote],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout);
      });
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
    const [logOut, branchOut, statusOut, aheadBehind, remoteOut] = await Promise.all([
      run(machine, ["git", "-C", cwd, "log", `-n${limit}`, `--pretty=format:${fmt}`]),
      run(machine, ["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
      run(machine, ["git", "-C", cwd, "status", "--porcelain"]).catch(() => ""),
      run(machine, ["git", "-C", cwd, "rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(() => ""),
      run(machine, ["git", "-C", cwd, "config", "--get", "remote.origin.url"]).catch(() => ""),
    ]);
    const remoteUrl = remoteOut.trim() || null;
    const webUrl = remoteUrl ? githubWebUrl(remoteUrl) : null;
    const commits: Commit[] = logOut.split(REC).map((r) => r.trim()).filter(Boolean).map((r) => {
      const [hash, author, relative, date, subject] = r.split(SEP);
      return { hash, author, relative, date, subject };
    });
    const dirty = statusOut.split("\n").filter((l) => l.trim()).length;
    const [behind, ahead] = aheadBehind.trim().split(/\s+/).map((n) => Number(n) || 0);
    return { ok: true, repo: true, branch: branchOut.trim() || null, ahead: ahead || 0, behind: behind || 0, dirty, commits, remoteUrl, webUrl };
  } catch (e) {
    return { ...empty, ok: false, repo: true, error: e instanceof Error ? e.message : String(e) };
  }
}
