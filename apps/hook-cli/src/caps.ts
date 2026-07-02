import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname, relative, sep } from "node:path";
import { createHash } from "node:crypto";

// Scan the Claude Code capabilities installed on this host — skills (SKILL.md)
// and slash commands (commands/*.md), personal + from installed plugins — so the
// cockpit can offer slash-command autocomplete and a searchable list.

export type CapItem = { name: string; description: string | null; source: string; hash?: string };
export type CapsSnapshot = { skills: CapItem[]; commands: CapItem[] };
export type SkillFile = { path: string; content: string };
export type SkillContent = { name: string; description: string | null; source: string; hash: string; files: SkillFile[] };

const MAX = 500; // safety cap per kind
const MAX_FILE_BYTES = 256 * 1024; // skip files larger than this (binary/huge)
const MAX_SKILL_FILES = 200; // safety cap on files read per skill dir

/** Pull `name`/`description` out of a leading `--- ... ---` YAML frontmatter block. */
function parseFrontmatter(text: string): { name?: string; description?: string } {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const fm = text.slice(3, end);
  const out: { name?: string; description?: string } = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^(name|description)\s*:\s*(.+)$/);
    if (m) out[m[1] as "name" | "description"] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function readHead(path: string, bytes = 4096): string {
  try { return readFileSync(path, "utf8").slice(0, bytes); } catch { return ""; }
}
function isDir(p: string): boolean { try { return statSync(p).isDirectory(); } catch { return false; } }
function isFile(p: string): boolean { try { return statSync(p).isFile(); } catch { return false; } }
function ls(dir: string): string[] { try { return readdirSync(dir); } catch { return []; } }

/** Recursively find files matching a predicate, bounded in depth to stay cheap. */
function walk(dir: string, match: (path: string, name: string) => boolean, depth = 6, out: string[] = []): string[] {
  if (depth < 0 || out.length >= MAX) return out;
  for (const name of ls(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    if (isDir(p)) walk(p, match, depth - 1, out);
    else if (match(p, name)) out.push(p);
    if (out.length >= MAX) break;
  }
  return out;
}

/** Best-effort plugin display name from a path like .../plugins/cache/<repo>/<plugin>/... */
function pluginSource(path: string): string {
  const m = path.match(/plugins\/(?:cache\/)?[^/]+\/([^/]+)/);
  return m ? `plugin:${m[1]}` : "plugin";
}

/** Looks like text (heuristic): no NUL byte in the first chunk. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Read every text file under a skill directory as {path (relative, posix), content}. */
export function readSkillDirFiles(dir: string): SkillFile[] {
  const out: SkillFile[] = [];
  const walkDir = (d: string, depth: number): void => {
    if (depth < 0 || out.length >= MAX_SKILL_FILES) return;
    for (const name of ls(d)) {
      if (name === "node_modules" || name === ".git") continue;
      if (out.length >= MAX_SKILL_FILES) break;
      const p = join(d, name);
      if (isDir(p)) { walkDir(p, depth - 1); continue; }
      if (!isFile(p)) continue;
      let buf: Buffer;
      try {
        if (statSync(p).size > MAX_FILE_BYTES) continue;
        buf = readFileSync(p);
      } catch { continue; }
      if (looksBinary(buf)) continue;
      const rel = relative(dir, p).split(sep).join("/");
      out.push({ path: rel, content: buf.toString("utf8") });
    }
  };
  walkDir(dir, 8);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Stable sha-256 over the sorted file paths + contents of a skill dir. */
export function hashSkillFiles(files: SkillFile[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path, "utf8");
    h.update("\0", "utf8");
    h.update(f.content, "utf8");
    h.update("\0", "utf8");
  }
  return h.digest("hex");
}

/** Locate a skill's directory on this host — personal first, then plugins. */
function findSkillDir(name: string, home: string): string | null {
  const claude = join(home, ".claude");
  const personal = join(claude, "skills", name);
  if (isFile(join(personal, "SKILL.md"))) return personal;
  // Plugin skills: match a SKILL.md whose dir basename OR frontmatter name matches.
  const pluginsRoot = join(claude, "plugins");
  for (const p of walk(pluginsRoot, (_p, n) => n === "SKILL.md")) {
    const dir = dirname(p);
    const fm = parseFrontmatter(readHead(p));
    if ((fm.name || basename(dir)) === name) return dir;
  }
  return null;
}

/** Read a single skill's full contents for upload, or null if not found. */
export function readSkillContent(name: string, home = homedir()): SkillContent | null {
  const dir = findSkillDir(name, home);
  if (!dir) return null;
  const files = readSkillDirFiles(dir);
  const skillMd = files.find((f) => f.path === "SKILL.md");
  const fm = skillMd ? parseFrontmatter(skillMd.content) : {};
  const isPersonal = dir === join(home, ".claude", "skills", name);
  return {
    name,
    description: fm.description ?? null,
    source: isPersonal ? "personal" : pluginSource(join(dir, "SKILL.md")),
    hash: hashSkillFiles(files),
    files,
  };
}

/**
 * Write a distributed skill's files under ~/.claude/skills/<name>/<relpath>, as a
 * global skill. Path traversal ("../") is rejected so a malicious payload can't
 * escape the skill directory. Returns the number of files written.
 */
export function installSkill(content: SkillContent, home = homedir()): number {
  const root = join(home, ".claude", "skills", content.name);
  let written = 0;
  for (const f of content.files) {
    // Reject absolute paths / traversal — keep every write inside the skill dir.
    const rel = f.path.replace(/\\/g, "/");
    if (!rel || rel.startsWith("/") || rel.split("/").includes("..")) continue;
    const dest = join(root, rel);
    if (!dest.startsWith(root + sep) && dest !== root) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content, "utf8");
    written++;
  }
  return written;
}

export function scanCaps(home = homedir()): CapsSnapshot {
  const claude = join(home, ".claude");
  const skills: CapItem[] = [];
  const commands: CapItem[] = [];
  const seenSkill = new Set<string>();
  const seenCmd = new Set<string>();

  const addSkill = (path: string, source: string) => {
    const fm = parseFrontmatter(readHead(path));
    const name = fm.name || basename(join(path, "..")); // skill dir name
    if (!name || seenSkill.has(name)) return;
    seenSkill.add(name);
    // Hash the whole skill dir so the server can detect presence + divergence cheaply.
    const hash = hashSkillFiles(readSkillDirFiles(dirname(path)));
    skills.push({ name, description: fm.description ?? null, source, hash });
  };
  const addCmd = (path: string, source: string) => {
    const fm = parseFrontmatter(readHead(path));
    const name = fm.name || basename(path).replace(/\.md$/, "");
    if (!name || seenCmd.has(name)) return;
    seenCmd.add(name);
    commands.push({ name, description: fm.description ?? null, source });
  };

  // Personal skills: ~/.claude/skills/<skill>/SKILL.md
  for (const d of ls(join(claude, "skills"))) {
    const p = join(claude, "skills", d, "SKILL.md");
    if (isFile(p)) addSkill(p, "personal");
  }
  // Personal commands: ~/.claude/commands/**/*.md
  for (const p of walk(join(claude, "commands"), (_p, n) => n.endsWith(".md"))) addCmd(p, "personal");

  // Plugin skills + commands: ~/.claude/plugins/**
  const pluginsRoot = join(claude, "plugins");
  for (const p of walk(pluginsRoot, (path, n) => n === "SKILL.md" || (n.endsWith(".md") && /\/commands\//.test(path)))) {
    if (basename(p) === "SKILL.md") addSkill(p, pluginSource(p));
    else addCmd(p, pluginSource(p));
  }

  const byName = (a: CapItem, b: CapItem) => a.name.localeCompare(b.name);
  return { skills: skills.sort(byName), commands: commands.sort(byName) };
}
