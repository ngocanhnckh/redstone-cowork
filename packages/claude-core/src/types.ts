// Structural mirrors of the `@rcw/shared` session types. Defined locally (not imported)
// so this package stays zero-dependency and safe to bundle into the Electron main process
// — see the "//deps" note in package.json. The shapes are identical to
// `TranscriptMessageSchema` / `TodoItemSchema` in packages/shared/src/sessions, so values
// cross the boundary structurally with no adapter.

export type TranscriptMessage = { role: "user" | "assistant"; text: string };

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoItem = { text: string; status: TodoStatus };

/** One assistant turn's token usage, as Claude Code records it. */
export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
  id?: string;
  tool_use_id?: string;
};

export type TranscriptLine = {
  type?: string;
  subtype?: string;
  /** system messages (e.g. local_command) carry content at top level */
  content?: unknown;
  message?: { role?: string; model?: string; content?: ContentBlock[] | string; usage?: Usage; stop_reason?: string };
};
