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
    child.stdin?.end(stdin);
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
  const flags = ["-rnI", args.caseSensitive ? "" : "-i", args.regex ? "-E" : "-F"].filter(Boolean).join(" ");
  const excludes = [".git", "node_modules", "dist", "build", ".next", "out", ".turbo", ".cache", "vendor"]
    .map((d) => `--exclude-dir=${d}`)
    .join(" ");
  // grep exits 1 on no matches; the `| head` pipeline makes the shell exit 0 regardless.
  const cmd = `grep ${flags} ${excludes} -e ${shellQuote(query)} ${shellQuote(cwd)} 2>/dev/null | head -n ${max + 1}`;
  try {
    const raw = isLocalMachine(machine) ? await localCapture(cmd) : await sshCapture(await getSshTarget(machine), cmd);
    const lines = raw.split("\n").filter(Boolean);
    const truncated = lines.length > max;
    const matches: SearchMatch[] = [];
    for (const l of lines.slice(0, max)) {
      const m = l.match(/^(.+?):(\d+):(.*)$/);
      if (m) matches.push({ path: m[1], line: Number(m[2]), text: m[3].slice(0, 400) });
    }
    return { ok: true, matches, truncated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

/** Extensions we preview as images / pdf rather than open in the text editor. */
export function isPreviewableBinary(name: string): boolean {
  const mime = mimeFor(name);
  return mime.startsWith("image/") || mime === "application/pdf";
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
    // Remote: one stat call per entry is too chatty; use a single find with printf.
    const sshTarget = await getSshTarget(machine);
    // %y = file type (d/f/l...), %s = size, %p = path. NUL-separate fields & records.
    const cmd = `cd ${shellQuote(dir)} && for n in * .*; do [ "$n" = "." ] || [ "$n" = ".." ] || [ ! -e "$n" -a ! -L "$n" ] || { if [ -d "$n" ]; then t=d; s=0; else t=f; s=$(wc -c < "$n" 2>/dev/null || echo 0); fi; printf '%s\\t%s\\t%s\\n' "$t" "$s" "$n"; }; done`;
    const out = await sshCapture(sshTarget, cmd);
    const entries: DirEntry[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [t, s, ...rest] = line.split("\t");
      const name = rest.join("\t");
      if (!name) continue;
      entries.push({
        name,
        path: dir.replace(/\/$/, "") + "/" + name,
        kind: t === "d" ? "dir" : "file",
        size: Number(s) || 0,
      });
    }
    return { ok: true, entries: sortEntries(entries) };
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

    // Remote.
    const sshTarget = await getSshTarget(machine);
    const size = Number(await sshCapture(sshTarget, `wc -c < ${shellQuote(file)}`)) || 0;
    if (isPreviewableBinary(name)) {
      if (size > MAX_BINARY_BYTES) return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
      const b64 = (await sshCapture(sshTarget, `base64 < ${shellQuote(file)}`)).replace(/\n/g, "");
      return { ok: true, encoding: "base64", content: b64, size, mime: mimeFor(name) };
    }
    if (size > MAX_TEXT_BYTES) return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
    const content = await sshCapture(sshTarget, `cat ${shellQuote(file)}`);
    if (looksBinary(Buffer.from(content.slice(0, 4096), "utf8"))) {
      return { ok: true, encoding: "binary", size, mime: mimeFor(name) };
    }
    return { ok: true, encoding: "text", content, size, truncated: false };
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
    await sshWrite(sshTarget, `base64 -d > ${shellQuote(file)}`, base64);
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
