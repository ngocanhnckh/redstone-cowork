import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { scanCaps, readSkillContent, installSkill, hashSkillFiles } from "../src/caps";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rcw-caps-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const write = (p: string, body: string) => { mkdirSync(join(home, join(p, "..")), { recursive: true }); writeFileSync(join(home, p), body); };

describe("scanCaps", () => {
  it("finds personal skills + commands and parses frontmatter", () => {
    write(".claude/skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: Does a thing\n---\nbody");
    write(".claude/commands/deploy.md", "---\ndescription: Ship it\n---\nrun deploy");
    write(".claude/commands/plain.md", "just text, no frontmatter");
    const { skills, commands } = scanCaps(home);
    expect(skills.map((s) => s.name)).toContain("my-skill");
    expect(skills.find((s) => s.name === "my-skill")?.description).toBe("Does a thing");
    expect(commands.map((c) => c.name)).toEqual(expect.arrayContaining(["deploy", "plain"]));
    expect(commands.find((c) => c.name === "deploy")?.description).toBe("Ship it");
    expect(commands.every((c) => c.source === "personal")).toBe(true);
  });

  it("discovers plugin skills + commands with a plugin source label", () => {
    write(".claude/plugins/cache/official/superpowers/5.1.0/skills/brainstorm/SKILL.md", "---\nname: brainstorming\ndescription: Plan ideas\n---");
    write(".claude/plugins/cache/official/superpowers/5.1.0/commands/plan.md", "---\ndescription: Make a plan\n---");
    const { skills, commands } = scanCaps(home);
    const sk = skills.find((s) => s.name === "brainstorming");
    expect(sk?.source).toBe("plugin:superpowers");
    const cmd = commands.find((c) => c.name === "plan");
    expect(cmd?.source).toBe("plugin:superpowers");
  });

  it("returns empty when nothing is installed", () => {
    expect(scanCaps(home)).toEqual({ skills: [], commands: [] });
  });

  it("reports a stable per-skill hash that changes when content changes", () => {
    write(".claude/skills/hasher/SKILL.md", "---\nname: hasher\n---\nbody v1");
    write(".claude/skills/hasher/extra.md", "reference");
    const h1 = scanCaps(home).skills.find((s) => s.name === "hasher")?.hash;
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // Same content → same hash.
    expect(scanCaps(home).skills.find((s) => s.name === "hasher")?.hash).toBe(h1);
    // Changed content → different hash.
    write(".claude/skills/hasher/SKILL.md", "---\nname: hasher\n---\nbody v2");
    expect(scanCaps(home).skills.find((s) => s.name === "hasher")?.hash).not.toBe(h1);
  });
});

describe("readSkillContent", () => {
  it("returns all files under the skill dir with a matching hash", () => {
    write(".claude/skills/full/SKILL.md", "---\nname: full\ndescription: A full skill\n---\nmain");
    write(".claude/skills/full/refs/notes.md", "some notes");
    const content = readSkillContent("full", home);
    expect(content).not.toBeNull();
    expect(content!.name).toBe("full");
    expect(content!.description).toBe("A full skill");
    expect(content!.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "refs/notes.md"]);
    expect(content!.hash).toBe(hashSkillFiles(content!.files));
  });

  it("returns null for an unknown skill", () => {
    expect(readSkillContent("nope", home)).toBeNull();
  });
});

describe("installSkill", () => {
  it("writes files under ~/.claude/skills/<name>/ and rejects traversal", () => {
    const written = installSkill(
      {
        name: "dist",
        description: "distributed",
        source: "org",
        hash: "x",
        files: [
          { path: "SKILL.md", content: "---\nname: dist\n---\nhello" },
          { path: "sub/doc.md", content: "doc" },
          { path: "../evil.md", content: "nope" },
        ],
      },
      home,
    );
    expect(written).toBe(2);
    expect(readFileSync(join(home, ".claude/skills/dist/SKILL.md"), "utf8")).toContain("hello");
    expect(readFileSync(join(home, ".claude/skills/dist/sub/doc.md"), "utf8")).toBe("doc");
    expect(existsSync(join(home, ".claude/evil.md"))).toBe(false);
    // The written skill round-trips through the scanner.
    expect(scanCaps(home).skills.map((s) => s.name)).toContain("dist");
  });
});
