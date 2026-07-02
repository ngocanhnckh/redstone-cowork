import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCaps } from "../src/caps";

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
});
