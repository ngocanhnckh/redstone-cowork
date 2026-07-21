import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { sshMuxOpts } from "./ssh-common";
import { isLocalMachine, getSshTarget, type SshTarget } from "./workspace";

// ---------------------------------------------------------------------------
// File browser backend — list directories, read files (text or binary), and
// write text files, for both local sessions (direct fs) and remote sessions
// (over the multiplexed SSH connection). Mirrors the split-brain in workspace.ts.
// ---------------------------------------------------------------------------

const SSH_TIMEOUT_MS = 15_000;
/** Reject text reads above this — keeps the editor responsive and the pipe small. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB
/** Reject binary previews above this — base64 over the wire gets expensive fast. */
export const MAX_BINARY_BYTES = 25 * 1024 * 1024; // 25 MB

export type DirEntry = {
  name: string;
  /** Absolute path on the session's machine. */
  path: string;
  kind: "dir" | "file";
  size: number;
};

export type ReadResult =
  | { ok: true; encoding: "text"; content: string; size: number; truncated: boolean }
  | { ok: true; encoding: "base64"; content: string; size: number; mime: string }
  | { ok: true; encoding: "binary"; size: number; mime: string } // too large / not previewable
  | { ok: false; error: string };

type Loc = { cwd: string; machine: string };

/** Single-quote a value for safe interpolation into a remote shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Parse the output of the single-round-trip read script, which emits the file's
 * byte size on the FIRST line, then the (capped) content. Splitting on the first
 * newline is unambiguous — the size line is always `echo`'d before any content.
 */
export function parseSizeFramed(out: string): { size: number; body: string } {
  const nl = out.indexOf("\n");
  if (nl < 0) return { size: Number(out.trim()) || 0, body: "" };
  return { size: Number(out.slice(0, nl).trim()) || 0, body: out.slice(nl + 1) };
}

function sshCapture(target: SshTarget, remoteCommand: string, encoding: "utf8" | "buffer" = "utf8"): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", target.host, remoteCommand],
      { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: encoding === "buffer" ? "buffer" : "utf8" },
      (err, stdout) => (err ? reject(err) : resolve(stdout as unknown as string))
    );
  });
}

function sshWrite(target: SshTarget, remoteCommand: string, stdin: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "ssh",
      [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", target.host, remoteCommand],
      { timeout: SSH_TIMEOUT_MS },
      (err) => (err ? reject(err) : resolve())
    );
    // A spawn failure (ssh missing, etc.) also surfaces here.
    child.on("error", reject);
    // CRITICAL: swallow errors on the stdin stream. When ssh (or the remote command)
    // closes the pipe before we finish writing — a dropped connection, the remote
    // `cat`/`base64 -d` exiting early — end()/write() emits EPIPE on child.stdin. With
    // no handler that becomes an UNCAUGHT exception that crashes the whole app. The
    // execFile callback above still rejects with the real cause, so the upload fails
    // cleanly instead.
    child.stdin?.on("error", () => { /* handled via the execFile callback / timeout */ });
    try {
      child.stdin?.end(stdin);
    } catch {
      /* pipe already gone — the callback rejects with the underlying error */
    }
  });
}

export type SearchMatch = { path: string; line: number; text: string };

/** Run a shell pipeline locally, resolving with stdout (tolerating SIGPIPE from `head`). */
function localCapture(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", cmd], { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      resolve(stdout as string);
    });
  });
}

/**
 * Project-wide text search (grep) under the session's cwd, local or over SSH. Skips
 * VCS/build dirs and binary files. `regex` toggles ERE vs. fixed-string; case-
 * insensitive by default. Capped to `maxResults` (default 500). Never throws.
 */
export async function searchFiles(
  args: Loc & { query: string; caseSensitive?: boolean; regex?: boolean; maxResults?: number }
): Promise<{ ok: true; matches: SearchMatch[]; truncated: boolean } | { ok: false; error: string }> {
  const { cwd, machine, query } = args;
  if (!query || !query.trim()) return { ok: true, matches: [], truncated: false };
  const max = Math.max(1, Math.min(2000, args.maxResults ?? 500));
  const cmd = grepCmd({ ...args, maxResults: max });
  try {
    const raw = isLocalMachine(machine) ? await localCapture(cmd) : await sshCapture(await getSshTarget(machine), cmd);
    const lines = raw.split("\n").filter(Boolean);
    const truncated = lines.length > max;
    const matches: SearchMatch[] = [];
    for (const l of lines.slice(0, max)) {
      const m = parseGrepLine(l);
      if (m) matches.push(m);
    }
    return { ok: true, matches, truncated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Parse one `path:line:text` grep record. Returns null for a malformed line.
 * Paths can contain colons, so the split is anchored on the `:<digits>:` that
 * grep always emits between the path and the line's text. */
export function parseGrepLine(line: string): SearchMatch | null {
  const m = line.match(/^(.+?):(\d+):(.*)$/);
  return m ? { path: m[1], line: Number(m[2]), text: m[3].slice(0, 400) } : null;
}

export type SearchHandle = { cancel: () => void };

/**
 * Streaming variant of `searchFiles`: emits matches as grep finds them instead of
 * buffering the whole run behind a 15s timeout. This is what makes search feel
 * instant — the first results land in well under a second on a large tree, and a
 * long search yields partial results instead of failing with "Command failed".
 *
 * `onBatch` is called with each group of new matches; `onDone` fires exactly once.
 * Returns a handle whose `cancel()` kills the underlying process (used when the
 * user edits the query, so a superseded search stops burning remote CPU).
 */
export async function searchFilesStream(
  args: Loc & { query: string; caseSensitive?: boolean; regex?: boolean; maxResults?: number },
  onBatch: (matches: SearchMatch[]) => void,
  onDone: (r: { truncated: boolean; error?: string }) => void
): Promise<SearchHandle> {
  const { machine, query } = args;
  if (!query || !query.trim()) {
    onDone({ truncated: false });
    return { cancel: () => {} };
  }
  const max = Math.max(1, Math.min(2000, args.maxResults ?? 500));
  const cmd = grepCmd({ ...args, maxResults: max });

  let child: ReturnType<typeof spawn>;
  // Resolving the ssh target is async, so a cancel() can arrive before the child
  // exists; `cancelled` makes that case kill the process as soon as it spawns.
  let cancelled = false;
  try {
    if (isLocalMachine(machine)) {
      child = spawn("/bin/sh", ["-c", cmd], { stdio: ["ignore", "pipe", "ignore"] });
    } else {
      const target = await getSshTarget(machine);
      child = spawn(
        "ssh",
        [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", target.host, cmd],
        { stdio: ["ignore", "pipe", "ignore"] }
      );
    }
  } catch (e) {
    onDone({ truncated: false, error: e instanceof Error ? e.message : String(e) });
    return { cancel: () => {} };
  }
  if (cancelled) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    return { cancel: () => {} };
  }

  let done = false;
  let count = 0;
  let truncated = false;
  let buf = "";
  const finish = (error?: string) => {
    if (done) return;
    done = true;
    onDone({ truncated, error });
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    // Keep the trailing partial line in the buffer until its newline arrives.
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    const batch: SearchMatch[] = [];
    for (const l of lines) {
      if (!l) continue;
      if (count >= max) {
        truncated = true;
        break;
      }
      const m = parseGrepLine(l);
      if (!m) continue;
      batch.push(m);
      count++;
    }
    if (batch.length) onBatch(batch);
    if (truncated) child.kill();
  });
  // Losing the pipe (we killed it after hitting the cap) is expected, not an error.
  child.stdout?.on("error", () => {});
  child.on("error", (e) => finish(e.message));
  child.on("close", () => finish());

  return {
    cancel: () => {
      done = true; // suppress onDone — the caller is no longer interested
      cancelled = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}

/** Build the grep pipeline shared by the buffered and streaming search paths. */
function grepCmd(args: Loc & { query: string; caseSensitive?: boolean; regex?: boolean; maxResults?: number }): string {
  const flags = ["-rnI", args.caseSensitive ? "" : "-i", args.regex ? "-E" : "-F"].filter(Boolean).join(" ");
  const excludes = [".git", "node_modules", "dist", "build", ".next", "out", ".turbo", ".cache", "vendor"]
    .map((d) => `--exclude-dir=${d}`)
    .join(" ");
  // grep exits 1 on no matches; the `| head` pipeline makes the shell exit 0 regardless.
  // `--line-buffered` is what lets matches stream out instead of sitting in grep's
  // 4KB stdio buffer until the whole tree has been walked.
  return `grep --line-buffered ${flags} ${excludes} -e ${shellQuote(args.query)} ${shellQuote(args.cwd)} 2>/dev/null | head -n ${(args.maxResults ?? 500) + 1}`;
}

/** Guess a MIME type from extension for inline preview (img/pdf) decisions. */
export function mimeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Office documents we preview via the OfficeViewer (parsed client-side from base64).
 * Kept in sync with isOfficeFile() in OfficeViewer.tsx. */
const OFFICE_RE = /\.(xlsx|xlsm|xls|docx|pptx)$/i;

/** Extensions read as base64 (not opened in the text editor) so the renderer can
 * preview them: images, PDFs, and Office documents (Word/Excel/PowerPoint). Without
 * this an Office file is sniffed as binary and returned with no content — the viewer
 * then shows "not previewable". */
export function isPreviewableBinary(name: string): boolean {
  const mime = mimeFor(name);
  return mime.startsWith("image/") || mime === "application/pdf" || OFFICE_RE.test(name);
}

/**
 * Heuristic: treat a file as binary if a sample of its bytes contains a NUL or a
 * high proportion of non-text bytes. Used to refuse opening true binaries in the
 * code editor (which would render mojibake).
 */
export function looksBinary(sample: Buffer): boolean {
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return true;
    // allow tab/newline/carriage-return + printable range
    if (b < 7 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.3;
}

// ----------------------------------- list ----------------------------------

/**
 * Remote directory listing as a SINGLE process, emitting `<type>\t<size>\t<name>`
 * per entry. GNU `find -printf` is the fast path; if it isn't available (BSD/
 * BusyBox find rejects `-printf` during argument parsing, before printing any
 * entries, so the `||` fallback can't produce duplicates) we fall back to a
 * python3 one-liner that yields the identical framing. Both are one exec — never
 * one-per-entry, which is what made this slow.
 */
export function remoteListCmd(dir: string): string {
  const q = shellQuote(dir);
  const find = `find -L . -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%f\\n' 2>/dev/null`;
  // os.scandir + stat(follow) mirrors `find -L`: symlinked dirs read as `d`,
  // broken links fall back to the link itself (`l`) instead of raising.
  const py = [
    `import os,sys`,
    `d='.'`,
    `for e in os.scandir(d):`,
    ` try: st=e.stat(); t='d' if os.path.isdir(e.path) else 'f'`,
    ` except OSError: st=None; t='l'`,
    ` sys.stdout.write('%s\\t%d\\t%s\\n'%(t, st.st_size if st else 0, e.name))`,
  ].join("\n");
  return `cd ${q} && { ${find} || python3 -c ${shellQuote(py)} 2>/dev/null; }`;
}

/**
 * Parse the tab-framed listing into entries. Names may legitimately contain tabs,
 * so only the first two fields are split off and the remainder is the name.
 * Type `d` is a directory; everything else (including `l`, a broken symlink) is
 * shown as a file so the tree renders it instead of failing the whole listing.
 */
export function parseFindList(out: string, dir: string): DirEntry[] {
  const base = dir.replace(/\/+$/, "");
  const entries: DirEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const first = line.indexOf("\t");
    const second = line.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const name = line.slice(second + 1);
    if (!name || name === "." || name === "..") continue;
    entries.push({
      name,
      path: base + "/" + name,
      kind: line.slice(0, first) === "d" ? "dir" : "file",
      size: Number(line.slice(first + 1, second)) || 0,
    });
  }
  return entries;
}

export async function listDir(args: Loc & { dir: string }): Promise<{ ok: true; entries: DirEntry[] } | { ok: false; error: string }> {
  const { machine, dir } = args;
  try {
    if (isLocalMachine(machine)) {
      const dirents = await fsp.readdir(dir, { withFileTypes: true });
      const entries: DirEntry[] = [];
      for (const d of dirents) {
        const full = path.join(dir, d.name);
        let size = 0;
        let isDir = d.isDirectory();
        try {
          const st = await fsp.stat(full); // follows symlinks
          isDir = st.isDirectory();
          size = st.size;
        } catch {
          // broken symlink etc — keep dirent's view
        }
        entries.push({ name: d.name, path: full, kind: isDir ? "dir" : "file", size });
      }
      return { ok: true, entries: sortEntries(entries) };
    }
    // Remote: ONE process, one round trip. The previous implementation globbed
    // `* .*` in the login shell and ran a `wc -c` SUBPROCESS PER ENTRY — on a
    // 35-entry dir over a relayed link that measured 6.4s, and a directory with a
    // broken symlink leaked `bash: <name>: No such file or directory` to stderr
    // (the `2>/dev/null` bound to `wc`, but the SHELL reports a failed redirect).
    // GNU find does the whole thing in one exec: %y = type (dereferenced under
    // -L, so a symlinked dir reports as `d`; a BROKEN link stays `l` and is
    // listed as a file rather than erroring), %s = size, %f = basename.
    const sshTarget = await getSshTarget(machine);
    const out = await sshCapture(sshTarget, remoteListCmd(dir));
    return { ok: true, entries: sortEntries(parseFindList(out, dir)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Dirs first, then files, each alphabetical (case-insensitive). */
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// ----------------------------------- read ----------------------------------

export async function readFileAt(args: Loc & { file: string }): Promise<ReadResult> {
  const { machine, file } = args;
  const name = file.split("/").pop() ?? file;
  try {
    if (isLocalMachine(machine)) {
      const st = await fsp.stat(file);
      const size = st.size;
      if (isPreviewableBinary(name)) {
        if (size > MAX_BINARY_BYTES) return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
        const buf = await fsp.readFile(file);
        return { ok: true, encoding: "base64", content: buf.toString("base64"), size, mime: mimeFor(name) };
      }
      if (size > MAX_TEXT_BYTES) return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
      const buf = await fsp.readFile(file);
      if (looksBinary(buf.subarray(0, 4096))) return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
      return { ok: true, encoding: "text", content: buf.toString("utf8"), size, truncated: false };
    }

    // Remote — ONE round trip. A tiny remote script emits the byte size on the
    // first line, then the content, but only when it's within the cap (so an
    // oversized file isn't streamed just to be discarded). This halves the SSH
    // round trips vs. the old size-probe-then-fetch and, crucially, avoids paying
    // the relay handshake twice on a cold ControlMaster — the freeze the user hit.
    const sshTarget = await getSshTarget(machine);
    const q = shellQuote(file);
    // `emit` reads the file a second time on the REMOTE host (local, fast) — still
    // one network round trip. `wc -c` fails (missing/no-perm) → non-zero exit → reject.
    const framed = async (cap: number, emit: "cat" | "base64") =>
      parseSizeFramed(await sshCapture(sshTarget, `n=$(wc -c < ${q}) || exit 1; echo "$n"; if [ "$n" -le ${cap} ]; then ${emit} < ${q}; fi`));

    if (isPreviewableBinary(name)) {
      const { size, body } = await framed(MAX_BINARY_BYTES, "base64");
      if (size > MAX_BINARY_BYTES) return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
      return { ok: true, encoding: "base64", content: body.replace(/\n/g, ""), size, mime: mimeFor(name) };
    }
    const { size, body } = await framed(MAX_TEXT_BYTES, "cat");
    if (size > MAX_TEXT_BYTES) return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
    if (looksBinary(Buffer.from(body.slice(0, 4096), "utf8"))) {
      return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
    }
    return { ok: true, encoding: "text", content: body, size, truncated: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Save a session file to a local path (the "Download" action). Unlike readFileAt
 * this has NO size cap and streams — a large binary downloads fine. Local sessions
 * copy directly; remote sessions stream `ssh … cat <file>` into the destination.
 */
export async function downloadFileTo(args: Loc & { file: string; dest: string }): Promise<{ ok: boolean; error?: string }> {
  const { machine, file, dest } = args;
  try {
    if (isLocalMachine(machine)) {
      await fsp.copyFile(file, dest);
      return { ok: true };
    }
    const target = await getSshTarget(machine);
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      out.on("error", reject);
      const child = spawn(
        "ssh",
        [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", target.host, `cat ${shellQuote(file)}`],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let err = "";
      child.stderr.on("data", (d) => { err += String(d); });
      child.on("error", reject);
      child.stdout.on("error", reject); // don't let a pipe error crash the process
      child.stdout.pipe(out);
      out.on("finish", () => (child.exitCode === 0 || child.exitCode === null ? resolve() : reject(new Error(err.trim() || `ssh exit ${child.exitCode}`))));
      child.on("close", (code) => { if (code !== 0) { out.destroy(); reject(new Error(err.trim() || `ssh exit ${code}`)); } });
    });
    return { ok: true };
  } catch (e) {
    // Best-effort: remove a partial file so a failed download doesn't leave junk.
    try { await fsp.unlink(dest); } catch { /* ignore */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ----------------------------------- write ---------------------------------

export async function writeFileAt(args: Loc & { file: string; content: string }): Promise<{ ok: boolean; error?: string }> {
  const { machine, file, content } = args;
  try {
    if (isLocalMachine(machine)) {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, content, "utf8");
      return { ok: true };
    }
    const sshTarget = await getSshTarget(machine);
    await sshWrite(sshTarget, `cat > ${shellQuote(file)}`, content);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Write a binary file from base64 (used to save edited Office docs). Locally we
 * decode + write the buffer; over SSH we pipe the base64 through `base64 -d`. */
export async function writeFileBase64(args: Loc & { file: string; base64: string }): Promise<{ ok: boolean; error?: string }> {
  const { machine, file, base64 } = args;
  try {
    const buf = Buffer.from(base64, "base64");
    if (isLocalMachine(machine)) {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, buf);
      return { ok: true };
    }
    const sshTarget = await getSshTarget(machine);
    // Feed the base64 text on stdin and decode it remotely into the target file.
    // mkdir -p the parent first so writing into a fresh dir (e.g. .rcw-shots/) works.
    const q = shellQuote(file);
    await sshWrite(sshTarget, `mkdir -p "$(dirname ${q})" && base64 -d > ${q}`, base64);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------ mutations ----------------------------------

/**
 * Guard every mutation to within the session's project dir: the target must be
 * the cwd itself or a descendant, and may not contain a `..` segment. Paths in
 * the tree are always built from cwd, so this only ever blocks tampering.
 */
export function isWithin(root: string, target: string): boolean {
  const r = root.replace(/\/+$/, "");
  if (target.split("/").includes("..")) return false;
  return target === r || target.startsWith(r + "/");
}

function joinRemote(dir: string, name: string): string {
  return dir.replace(/\/+$/, "") + "/" + name;
}

export async function deletePath(args: Loc & { path: string }): Promise<{ ok: boolean; error?: string }> {
  const { cwd, machine, path: target } = args;
  if (target.replace(/\/+$/, "") === cwd.replace(/\/+$/, ""))
    return { ok: false, error: "refusing to delete the project root" };
  if (!isWithin(cwd, target)) return { ok: false, error: "refusing to delete outside the project" };
  try {
    if (isLocalMachine(machine)) {
      await fsp.rm(target, { recursive: true, force: true });
      return { ok: true };
    }
    await sshCapture(await getSshTarget(machine), `rm -rf ${shellQuote(target)}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function makeDir(args: Loc & { parent: string; name: string }): Promise<{ ok: boolean; error?: string; path?: string }> {
  const { cwd, machine, parent, name } = args;
  const clean = name.trim();
  if (!clean || clean.includes("/") || clean === "." || clean === "..")
    return { ok: false, error: "invalid folder name" };
  const target = joinRemote(parent, clean);
  if (!isWithin(cwd, target)) return { ok: false, error: "refusing to create outside the project" };
  try {
    if (isLocalMachine(machine)) {
      await fsp.mkdir(target, { recursive: true });
      return { ok: true, path: target };
    }
    await sshCapture(await getSshTarget(machine), `mkdir -p ${shellQuote(target)}`);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createFile(args: Loc & { parent: string; name: string }): Promise<{ ok: boolean; error?: string; path?: string }> {
  const { cwd, machine, parent, name } = args;
  const clean = name.trim();
  if (!clean || clean.includes("/") || clean === "." || clean === "..")
    return { ok: false, error: "invalid file name" };
  const target = joinRemote(parent, clean);
  if (!isWithin(cwd, target)) return { ok: false, error: "refusing to create outside the project" };
  try {
    if (isLocalMachine(machine)) {
      if (fs.existsSync(target)) return { ok: false, error: "a file with that name already exists" };
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, "", { encoding: "utf8", flag: "wx" }); // wx = fail if exists
      return { ok: true, path: target };
    }
    // Remote: noclobber so we never truncate an existing file; `: >` makes it empty.
    await sshCapture(await getSshTarget(machine), `set -o noclobber; : > ${shellQuote(target)}`);
    return { ok: true, path: target };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /exist|noclobber|cannot overwrite/i.test(msg) ? "a file with that name already exists" : msg };
  }
}

/** Copy one already-chosen local file into destDir on the session's machine. */
export async function uploadLocalFile(args: Loc & { srcPath: string; destDir: string }): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { cwd, machine, srcPath, destDir } = args;
  const name = srcPath.split("/").pop() ?? "file";
  const target = joinRemote(destDir, name);
  if (!isWithin(cwd, target)) return { ok: false, error: "refusing to write outside the project" };
  try {
    if (isLocalMachine(machine)) {
      await fsp.copyFile(srcPath, target);
      return { ok: true, name };
    }
    const buf = await fsp.readFile(srcPath);
    await sshWrite(await getSshTarget(machine), `cat > ${shellQuote(target)}`, buf);
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Exposed for tests — proves the local path resolves files relative to a real dir. */
export const _internal = { sortEntries, fsExists: (p: string) => fs.existsSync(p) };
