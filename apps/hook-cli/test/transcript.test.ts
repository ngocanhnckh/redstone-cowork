import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastAssistantText, readRecentMessages, readLatestTodos, MAX_SUMMARY_CHARS } from "../src/transcript";

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

describe("readLatestTodos", () => {
  const todoLine = (todos: object[]) => ({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name: "TodoWrite", input: { todos } }] },
  });

  it("returns the latest TodoWrite, mapping content→text and clamping status", () => {
    const path = writeJsonl([
      todoLine([{ content: "old plan", status: "pending" }]),
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }] } },
      todoLine([
        { content: "ship feature", status: "in_progress" },
        { content: "write tests", status: "completed" },
        { content: "deploy", status: "weird" },
      ]),
    ]);
    expect(readLatestTodos(path)).toEqual([
      { text: "ship feature", status: "in_progress" },
      { text: "write tests", status: "completed" },
      { text: "deploy", status: "pending" },
    ]);
  });

  it("returns [] when there is no TodoWrite", () => {
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    expect(readLatestTodos(path)).toEqual([]);
  });

  it("returns [] for a missing path", () => {
    expect(readLatestTodos(null)).toEqual([]);
  });
});

describe("readRecentMessages", () => {
  it("renders an Edit tool_use as a diff snippet appended to the turn", () => {
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [
        { type: "text", text: "Updating the config." },
        { type: "tool_use", id: "t1", name: "Edit", input: {
          file_path: "src/config.ts", old_string: "const a = 1;", new_string: "const a = 2;",
        } },
      ] } },
    ]);
    const msgs = readRecentMessages(path);
    expect(msgs).toHaveLength(1);
    const text = msgs[0].text;
    expect(text).toContain("Updating the config.");
    expect(text).toContain("✎");
    expect(text).toContain("src/config.ts");
    expect(text).toContain("```diff");
    expect(text).toContain("- const a = 1;");
    expect(text).toContain("+ const a = 2;");
  });

  it("includes an edit-only assistant turn (no text block)", () => {
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Edit", input: {
          file_path: "src/x.ts", old_string: "foo", new_string: "bar",
        } },
      ] } },
    ]);
    const msgs = readRecentMessages(path);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].text).toContain("- foo");
    expect(msgs[0].text).toContain("+ bar");
  });

  it("renders a Write tool_use as a new-file diff", () => {
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Write", input: {
          file_path: "src/new.ts", content: "line1\nline2",
        } },
      ] } },
    ]);
    const text = readRecentMessages(path)[0].text;
    expect(text).toContain("(new file)");
    expect(text).toContain("+ line1");
    expect(text).toContain("+ line2");
  });

  it("renders MultiEdit as one header with multiple hunks", () => {
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "MultiEdit", input: {
          file_path: "src/m.ts", edits: [
            { old_string: "a1", new_string: "b1" },
            { old_string: "a2", new_string: "b2" },
          ],
        } },
      ] } },
    ]);
    const text = readRecentMessages(path)[0].text;
    expect(text).toContain("src/m.ts");
    expect((text.match(/✎/g) || []).length).toBe(1);
    expect(text).toContain("- a1");
    expect(text).toContain("+ b1");
    expect(text).toContain("- a2");
    expect(text).toContain("+ b2");
  });

  it("ignores non-edit tool calls and keeps prose / user turns", () => {
    const path = writeJsonl([
      { type: "user", message: { role: "user", content: "do the thing" } },
      { type: "assistant", message: { role: "assistant", content: [
        { type: "text", text: "Running a command." },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ] } },
    ]);
    const msgs = readRecentMessages(path);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].text).toBe("Running a command.");
    expect(msgs[1].text).not.toContain("```diff");
  });

  it("truncates an oversized diff block", () => {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const path = writeJsonl([
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Write", input: { file_path: "big.ts", content: big } },
      ] } },
    ]);
    expect(readRecentMessages(path)[0].text).toContain("… (truncated)");
  });
});
