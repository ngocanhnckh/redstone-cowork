import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastAssistantText, MAX_SUMMARY_CHARS } from "../src/transcript";

const made: string[] = [];
const writeJsonl = (lines: object[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "rcw-transcript-"));
  made.push(dir);
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
};

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("readLastAssistantText", () => {
  it("returns null for a missing or empty path", () => {
    expect(readLastAssistantText(null)).toBeNull();
    expect(readLastAssistantText("/no/such/file.jsonl")).toBeNull();
  });

  it("returns the most recent assistant text block", () => {
    const path = writeJsonl([
      { type: "user", message: { role: "user", content: "hi" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "first answer" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Here is my summary of the work." }] } },
    ]);
    expect(readLastAssistantText(path)).toBe("Here is my summary of the work.");
  });

  it("skips trailing tool_use-only turns to find the last prose", () => {
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Let me run the command." }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } },
    ]);
    expect(readLastAssistantText(path)).toBe("Let me run the command.");
  });

  it("joins multiple text blocks in a single assistant message", () => {
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [
        { type: "text", text: "line one" },
        { type: "tool_use", id: "t", name: "X", input: {} },
        { type: "text", text: "line two" },
      ] } },
    ]);
    expect(readLastAssistantText(path)).toBe("line one\nline two");
  });

  it("caps very long messages at MAX_SUMMARY_CHARS", () => {
    const long = "x".repeat(MAX_SUMMARY_CHARS + 500);
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: long }] } },
    ]);
    expect(readLastAssistantText(path)!.length).toBe(MAX_SUMMARY_CHARS);
  });

  it("ignores malformed lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-transcript-"));
    made.push(dir);
    const path = join(dir, "session.jsonl");
    writeFileSync(path, 'not json\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\n');
    expect(readLastAssistantText(path)).toBe("ok");
  });
});
