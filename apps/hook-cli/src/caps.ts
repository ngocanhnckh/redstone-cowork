import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

// Scan the Claude Code capabilities installed on this host — skills (SKILL.md)
// and slash commands (commands/*.md), personal + from installed plugins — so the
// cockpit can offer slash-command autocomplete and a searchable list.

export type CapItem = { name: string; description: string | null; source: string };
export type CapsSnapshot = { skills: CapItem[]; commands: CapItem[] };

const MAX = 500; // safety cap per kind

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
    skills.push({ name, description: fm.description ?? null, source });
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
