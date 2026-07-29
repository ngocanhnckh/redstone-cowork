import { describe, it, expect } from "vitest";
import {
  parseRecentMessages,
  parseLastAssistantText,
  parseLatestUsage,
  parseLatestTodos,
  sumUsage,
  renderCommandString,
} from "../src/transcript/parse.js";

const assistant = (text: string) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const user = (content: unknown) => JSON.stringify({ type: "user", message: { role: "user", content } });
const usageLine = (u: Record<string, number>, model = "claude-opus-5") =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", model, usage: u, content: [{ type: "text", text: "x" }] } });

describe("parseRecentMessages", () => {
  it("returns user prompts and assistant prose oldest→newest", () => {
    const text = [user("do the thing"), assistant("done")].join("\n");
    expect(parseRecentMessages(text)).toEqual([
      { role: "user", text: "do the thing" },
      { role: "assistant", text: "done" },
    ]);
  });

  it("skips tool-use-only turns", () => {
    const toolOnly = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
    });
    expect(parseRecentMessages([user("go"), toolOnly].join("\n"))).toEqual([{ role: "user", text: "go" }]);
  });

  it("renders an Edit tool_use as a diff block alongside the prose", () => {
    const edit = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "patching" },
          { type: "tool_use", name: "Edit", input: { file_path: "/a.ts", old_string: "one", new_string: "two" } },
        ],
      },
    });
    const [msg] = parseRecentMessages(edit);
    expect(msg.text).toContain("patching");
    expect(msg.text).toContain("```diff");
    expect(msg.text).toContain("- one");
    expect(msg.text).toContain("+ two");
  });

  it("surfaces background-task notices but not ordinary tool_result noise", () => {
    const noisy = user([{ type: "tool_result", content: "total 24\ndrwxr-xr-x" }]);
    const notable = user([{ type: "tool_result", content: "Command running in background" }]);
    expect(parseRecentMessages(noisy)).toEqual([]);
    expect(parseRecentMessages(notable)).toEqual([{ role: "user", text: "Command running in background" }]);
  });

  it("honours the limit, keeping the newest messages", () => {
    const text = Array.from({ length: 10 }, (_, i) => user(`m${i}`)).join("\n");
    const out = parseRecentMessages(text, 3);
    expect(out.map((m) => m.text)).toEqual(["m7", "m8", "m9"]);
  });

  it("returns [] rather than throwing on garbage", () => {
    expect(parseRecentMessages("not json\n{broken")).toEqual([]);
  });
});

describe("renderCommandString", () => {
  it("turns a bash-input tag into a shell line", () => {
    expect(renderCommandString("<bash-input>ls -la</bash-input>")).toBe("$ ls -la");
  });

  it("joins a slash command with its args", () => {
    expect(renderCommandString("<command-name>/review</command-name><command-args>main</command-args>")).toBe("$ /review main");
  });

  it("returns null for empty command output so the turn is skipped", () => {
    expect(renderCommandString("<local-command-stdout></local-command-stdout>")).toBeNull();
  });

  it("passes untagged prose straight through", () => {
    expect(renderCommandString("just words")).toBe("just words");
  });
});

describe("parseLastAssistantText", () => {
  it("returns the newest assistant prose", () => {
    expect(parseLastAssistantText([assistant("first"), user("q"), assistant("second")].join("\n"))).toBe("second");
  });

  it("returns null when there is no assistant prose", () => {
    expect(parseLastAssistantText(user("only me"))).toBeNull();
  });
});

describe("parseLatestUsage", () => {
  it("sums the whole input side for the context figure", () => {
    const text = usageLine({ input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 7 });
    // context = input + cache_read + cache_creation; output is NOT context
    expect(parseLatestUsage(text)).toEqual({ contextTokens: 1050, model: "claude-opus-5" });
  });

  it("prefers the latest assistant turn", () => {
    const text = [usageLine({ input_tokens: 10 }), usageLine({ input_tokens: 20 }, "claude-sonnet-5")].join("\n");
    expect(parseLatestUsage(text)).toEqual({ contextTokens: 20, model: "claude-sonnet-5" });
  });

  it("returns nulls when no usage is present", () => {
    expect(parseLatestUsage(assistant("hi"))).toEqual({ contextTokens: null, model: null });
  });

  it("skips Claude Code's synthetic notices and reports the last real turn", () => {
    // Verified against a live transcript: local notices ("You've hit your session
    // limit…") are recorded as assistant turns with model "<synthetic>" and all-zero
    // usage. Stopping at one loses the real context size and shows "<synthetic>"
    // where the model name belongs.
    const text = [
      usageLine({ input_tokens: 500, cache_read_input_tokens: 200, output_tokens: 30 }, "claude-opus-5"),
      usageLine({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, "<synthetic>"),
    ].join("\n");
    expect(parseLatestUsage(text)).toEqual({ contextTokens: 700, model: "claude-opus-5" });
  });

  it("still reports nulls when every turn is synthetic", () => {
    const text = usageLine({ input_tokens: 0, output_tokens: 0 }, "<synthetic>");
    expect(parseLatestUsage(text)).toEqual({ contextTokens: null, model: null });
  });
});

describe("sumUsage", () => {
  const lines = [
    usageLine({ input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 5000, output_tokens: 20 }),
    usageLine({ input_tokens: 200, cache_creation_input_tokens: 30, cache_read_input_tokens: 9000, output_tokens: 40 }),
  ];

  it("sums fresh input and output, excluding ~free cache reads", () => {
    expect(sumUsage(lines)).toEqual({ tokensInput: 340, tokensOutput: 60 });
  });

  // This property is what makes the server-side usage ingest idempotent: both the
  // hosted agent and the direct desktop compute the same ABSOLUTE total from the same
  // transcript, so re-sending a flush is a no-op and neither can double-count.
  it("is cumulative-absolute, so recomputing the same lines is stable", () => {
    expect(sumUsage(lines)).toEqual(sumUsage(lines));
    expect(sumUsage([...lines, usageLine({ input_tokens: 1, output_tokens: 2 })])).toEqual({
      tokensInput: 341,
      tokensOutput: 62,
    });
  });

  it("ignores user turns and unparseable lines", () => {
    expect(sumUsage([...lines, "garbage", user("usage")])).toEqual({ tokensInput: 340, tokensOutput: 60 });
  });
});

describe("parseLatestTodos", () => {
  const toolUse = (name: string, input: unknown) =>
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input }] } });

  it("folds TaskCreate/TaskUpdate events into a list", () => {
    const lines = [
      toolUse("TaskCreate", { subject: "one" }),
      toolUse("TaskCreate", { subject: "two" }),
      toolUse("TaskUpdate", { taskId: "1", status: "completed" }),
    ];
    expect(parseLatestTodos(lines)).toEqual([
      { text: "one", status: "completed" },
      { text: "two", status: "pending" },
    ]);
  });

  it("drops cancelled tasks", () => {
    const lines = [
      toolUse("TaskCreate", { subject: "keep" }),
      toolUse("TaskCreate", { subject: "drop" }),
      toolUse("TaskUpdate", { taskId: "2", status: "cancelled" }),
    ];
    expect(parseLatestTodos(lines)).toEqual([{ text: "keep", status: "pending" }]);
  });

  it("falls back to the newest TodoWrite when no Task events exist", () => {
    const lines = [
      toolUse("TodoWrite", { todos: [{ content: "old", status: "pending" }] }),
      toolUse("TodoWrite", { todos: [{ content: "new", status: "in_progress" }] }),
    ];
    expect(parseLatestTodos(lines)).toEqual([{ text: "new", status: "in_progress" }]);
  });

  it("returns [] for a transcript with no todos", () => {
    expect(parseLatestTodos([assistant("nothing here")])).toEqual([]);
  });
});
