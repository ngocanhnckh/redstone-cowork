import { describe, it, expect } from "vitest";
import { buildDecisionSpec } from "../src/decision-spec";

const permissionEvent = {
  hook_event_name: "PermissionRequest",
  session_id: "s",
  cwd: "/p",
  tool_name: "Bash",
  tool_input: { command: "npm install" },
};

const questionEvent = {
  hook_event_name: "PermissionRequest",
  session_id: "s",
  cwd: "/p",
  tool_name: "AskUserQuestion",
  tool_input: {
    questions: [
      {
        question: "Which approach?",
        header: "Approach",
        options: [
          { label: "A", description: "fast" },
          { label: "B", description: "safe" },
        ],
        multiSelect: false,
      },
    ],
  },
};

const questionEventNoQuestions = {
  hook_event_name: "PermissionRequest",
  session_id: "s",
  cwd: "/p",
  tool_name: "AskUserQuestion",
  tool_input: { questions: [] },
};

describe("buildDecisionSpec", () => {
  it("permission → Allow/Deny + title contains tool name", () => {
    const spec = buildDecisionSpec(permissionEvent, false);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe("permission");
    expect(spec!.title).toContain("Bash");
    expect(spec!.options.map((o) => o.label)).toEqual(["Allow", "Deny"]);
    expect(spec!.body.tool_input).toEqual({ command: "npm install" });
    expect(spec!.body.deliverable).toBe(false);
  });

  it("AskUserQuestion → kind question, options carried, title = question text", () => {
    const spec = buildDecisionSpec(questionEvent, true);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe("question");
    expect(spec!.title).toBe("Which approach?");
    expect(spec!.options).toEqual([
      { label: "A", description: "fast" },
      { label: "B", description: "safe" },
    ]);
    expect(spec!.body.deliverable).toBe(true);
  });

  it("AskUserQuestion with no questions → null", () => {
    const spec = buildDecisionSpec(questionEventNoQuestions, false);
    expect(spec).toBeNull();
  });

  it("multi-question AskUserQuestion → body retains ALL questions for the web + keymap", () => {
    const multi = {
      hook_event_name: "PermissionRequest",
      session_id: "s",
      cwd: "/p",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          { question: "Framework?", options: [{ label: "React" }, { label: "Vue" }] },
          { question: "Bundler?", options: [{ label: "Vite" }, { label: "Webpack" }] },
        ],
      },
    };
    const spec = buildDecisionSpec(multi, true);
    expect(spec).not.toBeNull();
    const questions = (spec!.body.tool_input as { questions: unknown[] }).questions;
    expect(questions).toHaveLength(2);
  });
});
