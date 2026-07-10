import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ScannedSession = {
  id: string;
  cwd: string;
  title: string | null;
  lastActive: string; // ISO
  messageCount: number;
  sizeBytes: number;
};

/** Root where Claude Code stores per-project session transcripts. */
export function projectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * Locate a session's transcript by its id across ALL project folders. Robust
 * against how Claude slugifies the cwd into a folder name (dots, spaces, etc.) —
 * the session id (the jsonl filename) is globally unique, so we just find the file
 * rather than recomputing the slug. Returns the full path, or null.
 */
export function findTranscriptPath(sessionId: string, root = projectsRoot()): string | null {
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const p = join(root, dir, `${sessionId}.jsonl`);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // not in this folder — keep looking
    }
  }
  return null;
}

/**
 * The most-recently-modified transcript in a cwd's project folder — i.e. whatever
 * Claude is actively writing right now, regardless of session-id changes across
 * resume/continue. Used by the poller's hook-independent sync so it always reflects
 * the live conversation, not a stale file named after the originally-attached id.
 */
export function newestTranscript(cwd: string, root = projectsRoot()): { path: string; mtimeMs: number } | null {
  const dir = join(root, cwd.replace(/\//g, "-"));
  let best: { path: string; mtimeMs: number } | null = null;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try {
        const m = statSync(p).mtimeMs;
        if (!best || m > best.mtimeMs) best = { path: p, mtimeMs: m };
      } catch { /* file vanished — skip */ }
    }
  } catch {
    return null;
  }
  return best;
}

/** Read the first `bytes` of a file as UTF-8 (for cheap head parsing of huge transcripts). */
function readHead(path: string, bytes: number): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = statSync(path).size;
    const len = Math.min(bytes, size);
    if (len <= 0) return "";
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, 0);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * Extract cwd + a title from the head of a transcript. The cwd is read from the
 * first line that carries a `cwd` field (the folder slug is lossy, so we don't
 * un-slug). The title is the first user message's text, truncated.
 */
function parseHead(head: string): { cwd: string | null; title: string | null } {
  let cwd: string | null = null;
  let title: string | null = null;
  for (const line of head.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: { cwd?: unknown; message?: { role?: string; content?: unknown }; type?: string };
    try { obj = JSON.parse(t); } catch { continue; }
    if (!cwd && typeof obj.cwd === "string") cwd = obj.cwd;
    if (!title) {
      const role = obj.message?.role ?? obj.type;
      if (role === "user") {
        const c = obj.message?.content;
        let text = "";
        if (typeof c === "string") text = c;
        else if (Array.isArray(c)) {
          const block = c.find((b: { type?: string; text?: string }) => b?.type === "text" && typeof b.text === "string");
          text = block?.text ?? "";
        }
        text = text.trim();
        // Skip tool-result / command noise; take the first real prompt.
        if (text && !text.startsWith("<")) title = text.slice(0, 120);
      }
    }
    if (cwd && title) break;
  }
  return { cwd, title };
}

/** Count newlines in a file cheaply by streaming fixed-size chunks. */
function countLines(path: string): number {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = statSync(path).size;
    const buf = Buffer.allocUnsafe(64 * 1024);
    let pos = 0;
    let lines = 0;
    while (pos < size) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      pos += n;
    }
    return lines;
  } catch {
    return 0;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * Scan every `~/.claude/projects/<slug>/<id>.jsonl` and return one entry per
 * session. Sessions whose cwd can't be recovered are skipped (they can't be
 * grouped by folder). Never throws — a bad file is skipped. `root` and `head
 * bytes` are injectable for tests.
 */
export function scanSessions(root = projectsRoot(), headBytes = 64 * 1024): ScannedSession[] {
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // no projects dir yet
  }
  const out: ScannedSession[] = [];
  for (const dir of dirs) {
    const dirPath = join(root, dir);
    let files: string[];
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(dirPath, file);
      try {
        const st = statSync(path);
        const { cwd, title } = parseHead(readHead(path, headBytes));
        if (!cwd) continue; // can't place it in a folder — skip
        out.push({
          id: file.replace(/\.jsonl$/, ""),
          cwd,
          title,
          lastActive: st.mtime.toISOString(),
          messageCount: countLines(path),
          sizeBytes: st.size,
        });
      } catch {
        continue;
      }
    }
  }
  return out;
}
