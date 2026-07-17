import { openSync, fstatSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
import type { TranscriptMessage, TodoItem } from "@rcw/shared";

/** Cap stored message length — enough to read on expand, small enough not to bloat the payload/DB. */
export const MAX_SUMMARY_CHARS = 2000;

/** Assistant turns may carry diff snippets, so they get a higher cap than plain user prose. */
export const MAX_ASSISTANT_CHARS = 6000;

/** Per-diff-block caps so a single huge edit can't bloat the payload. */
const MAX_DIFF_LINES = 60;
const MAX_DIFF_CHARS = 1500;

/** Only scan the tail of the transcript; the last assistant prose is always near the
 * end. Sized so the recent-messages window (see readRecentMessages `limit`) can be
 * filled even in tool-heavy sessions where many JSONL lines are non-prose. */
const TAIL_BYTES = 768 * 1024;

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

type ContentBlock = { type?: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };
type TranscriptLine = {
  type?: string;
  subtype?: string;
  content?: unknown; // system messages (e.g. local_command) carry content at top level
  message?: { role?: string; content?: ContentBlock[] | string };
};

/** Strip one `<tag>…</tag>` wrapper and return its inner text, or null if absent. */
function unwrapTag(s: string, tag: string): string | null {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

/**
 * Claude Code represents user "!" bash commands and slash commands as XML-ish
 * tagged strings, and their output as `<local-command-stdout>` (or bash-stdout).
 * Turn those into clean chat text ("$ <cmd>" / the output), or return the string
 * unchanged when it carries no command tags. Empty output → null (skip the turn).
 */
function renderCommandString(s: string): string | null {
  if (s.indexOf("<") < 0) return s; // fast path — no tags at all
  const bashIn = unwrapTag(s, "bash-input");
  if (bashIn !== null) return `$ ${bashIn}`;
  const cmdName = unwrapTag(s, "command-name");
  if (cmdName !== null) {
    const args = unwrapTag(s, "command-args");
    return `$ ${cmdName}${args ? " " + args : ""}`;
  }
  const stdout = unwrapTag(s, "local-command-stdout") ?? unwrapTag(s, "bash-stdout");
  if (stdout !== null) return stdout || null; // empty stdout → nothing to show
  const stderr = unwrapTag(s, "bash-stderr");
  if (stderr !== null) return stderr || null;
  return s;
}

/** True if a tool_result's text is a notable status worth surfacing in the chat
 *  (background-command start/finish notices) rather than ordinary tool output noise. */
function isNotableToolResult(text: string): boolean {
  return /running in background|background task .*(completed|finished|failed)|Command running in background/i.test(text);
}

/** Split a string into lines, defending against non-string input. */
function toLines(s: unknown): string[] {
  return typeof s === "string" ? s.split("\n") : [];
}

/** Build a fenced ```diff block from `-`/`+` prefixed lines, capped by lines & chars. */
function diffBlock(lines: string[]): string {
  let truncated = false;
  let kept = lines;
  if (kept.length > MAX_DIFF_LINES) {
    kept = kept.slice(0, MAX_DIFF_LINES);
    truncated = true;
  }
  let body = kept.join("\n");
  if (body.length > MAX_DIFF_CHARS) {
    body = body.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }
  if (truncated) body += "\n… (truncated)";
  return "```diff\n" + body + "\n```";
}

/** Format a single edit-family tool_use block into a compact markdown snippet, or null to skip. */
function formatEditTool(block: ContentBlock): string | null {
  try {
    const name = block.name;
    const input = block.input as Record<string, unknown> | undefined;
    if (!input || typeof input !== "object") return null;

    if (name === "Edit") {
      const fp = input.file_path;
      if (typeof fp !== "string") return null;
      const lines = [
        ...toLines(input.old_string).map((l) => "- " + l),
        ...toLines(input.new_string).map((l) => "+ " + l),
      ];
      return `**✎ ${fp}**\n` + diffBlock(lines);
    }

    if (name === "Write") {
      const fp = input.file_path;
      if (typeof fp !== "string") return null;
      const lines = toLines(input.content).map((l) => "+ " + l);
      return `**✎ ${fp} (new file)**\n` + diffBlock(lines);
    }

    if (name === "MultiEdit") {
      const fp = input.file_path;
      if (typeof fp !== "string" || !Array.isArray(input.edits)) return null;
      const hunks: string[][] = [];
      for (const e of input.edits as Array<Record<string, unknown>>) {
        if (!e || typeof e !== "object") continue;
        hunks.push([
          ...toLines(e.old_string).map((l) => "- " + l),
          ...toLines(e.new_string).map((l) => "+ " + l),
        ]);
      }
      if (!hunks.length) return null;
      // Separate each edit's hunk with a blank line.
      const lines = hunks.flatMap((h, i) => (i === 0 ? h : ["", ...h]));
      return `**✎ ${fp}**\n` + diffBlock(lines);
    }

    if (name === "NotebookEdit") {
      const fp = input.notebook_path ?? input.file_path;
      if (typeof fp !== "string") return null;
      const lines = toLines(input.new_source).map((l) => "+ " + l);
      return `**✎ ${fp} (cell)**\n` + diffBlock(lines);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Read the most recent assistant *text* the user saw, from a Claude Code session
 * transcript (JSONL). Tool-use-only turns are skipped — we want Claude's prose,
 * which reads like a summary of what it just did or is asking. Returns null when
 * nothing usable is found (missing file, no text blocks, parse errors).
 *
 * Bounded: reads only the last TAIL_BYTES so cost is constant regardless of how
 * long the session has run. Never throws — callers run inside the hook handler,
 * which must never break the user's session.
 */
// Hard ceiling on the transcript payload we POST on every hook event. Even 150 capped
// messages can add up to ~1 MB, which flooded the API with 413 PayloadTooLarge on big
// sessions. Keep the NEWEST messages under this budget (the cockpit shows a rolling
// window anyway); always keep at least the most recent message.
const MAX_TRANSCRIPT_BYTES = 400 * 1024;
function capMessages(msgs: TranscriptMessage[]): TranscriptMessage[] {
  let total = 0;
  const kept: TranscriptMessage[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const size = Buffer.byteLength(msgs[i].text, "utf8") + 16; // + small per-message overhead
    if (kept.length && total + size > MAX_TRANSCRIPT_BYTES) break;
    total += size;
    kept.unshift(msgs[i]);
  }
  return kept;
}

/** Recent user prompts + assistant prose from the transcript tail, oldest→newest,
 * capped at `limit` (the cockpit's scroll-back window — posted on every hook event,
 * so it's a rolling window of the tail, not the full on-disk history). */
export function readRecentMessages(path: string | null | undefined, limit = 150): TranscriptMessage[] {
  if (!path) return [];
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return [];
    const buf = Buffer.allocUnsafe(length);
    readSync(fd, buf, 0, length, start);
    let text = buf.toString("utf8");
    if (start > 0) { const nl = text.indexOf("\n"); text = nl >= 0 ? text.slice(nl + 1) : ""; }
    const out: TranscriptMessage[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let obj: TranscriptLine;
      try { obj = JSON.parse(t); } catch { continue; }

      // Local command output (a "!" bash command or slash command) is a system
      // message with the text in a top-level `content` string (`<local-command-
      // stdout>…`). Surface it as an assistant-side output block so the cockpit
      // mirrors what the user saw in the terminal, instead of dropping it.
      if (obj.type === "system" && obj.subtype === "local_command" && typeof obj.content === "string") {
        const outText = renderCommandString(obj.content);
        if (outText) out.push({ role: "assistant", text: outText.slice(0, MAX_ASSISTANT_CHARS) });
        continue;
      }

      const role = obj.message?.role ?? (obj.type === "assistant" ? "assistant" : obj.type === "user" ? "user" : undefined);
      if (role !== "assistant" && role !== "user") continue;
      const content = obj.message?.content;
      let prose = "";
      const edits: string[] = [];
      if (typeof content === "string") {
        // A "!" bash / slash command the user typed arrives as a tagged string —
        // clean it to "$ <cmd>" so it renders instead of disappearing / showing raw XML.
        prose = renderCommandString(content) ?? "";
      } else if (Array.isArray(content)) {
        prose = content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text!).join("\n").trim();
        if (role === "assistant") {
          for (const b of content) {
            if (b?.type === "tool_use" && typeof b.name === "string" && EDIT_TOOLS.has(b.name)) {
              const snip = formatEditTool(b);
              if (snip) edits.push(snip);
            }
          }
        } else {
          // User turns also carry tool_result blocks. Most are ordinary tool output
          // (noise), but the "Command running in background…" notice IS the status
          // the user is waiting on — surface just those, not every tool_result.
          for (const b of content) {
            if (b?.type !== "tool_result") continue;
            const rt = typeof b.content === "string" ? b.content
              : Array.isArray(b.content) ? (b.content as ContentBlock[]).filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text!).join("\n")
              : "";
            if (rt && isNotableToolResult(rt)) prose = prose ? prose + "\n" + rt.trim() : rt.trim();
          }
        }
      }
      let text = prose;
      if (edits.length) text = text ? text + "\n\n" + edits.join("\n\n") : edits.join("\n\n");
      if (!text) continue; // skip turns with no prose and no edits (other tool calls / tool_result)
      const cap = role === "assistant" ? MAX_ASSISTANT_CHARS : MAX_SUMMARY_CHARS;
      out.push({ role: role as "user" | "assistant", text: text.slice(0, cap) });
    }
    return capMessages(out.slice(-limit));
  } catch {
    return [];
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/** Upper bound on transcript size we'll fully scan for todos (only done when a
 * todo/task tool ran, so an occasional large read is fine). */
const MAX_TODO_SCAN_BYTES = 80 * 1024 * 1024;

function normStatus(s: unknown): TodoItem["status"] | "cancelled" {
  if (s === "completed") return "completed";
  if (s === "in_progress") return "in_progress";
  if (s === "cancelled" || s === "canceled" || s === "deleted") return "cancelled";
  return "pending";
}

/** Latest standard `TodoWrite` list from transcript lines (newest wins). */
function latestTodoWrite(lines: string[]): TodoItem[] | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes("TodoWrite")) continue;
    let obj: TranscriptLine;
    try { obj = JSON.parse(line); } catch { continue; }
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "tool_use" && b.name === "TodoWrite") {
        const raw = (b.input as { todos?: unknown })?.todos;
        if (!Array.isArray(raw)) continue;
        const todos: TodoItem[] = [];
        for (const t of raw as Array<Record<string, unknown>>) {
          const txt = typeof t?.content === "string" ? t.content : typeof t?.text === "string" ? t.text : "";
          if (!txt) continue;
          const st = normStatus(t?.status);
          if (st === "cancelled") continue;
          todos.push({ text: txt.slice(0, 300), status: st });
        }
        return todos;
      }
    }
  }
  return null;
}

/**
 * The session's current to-do list, from Claude's own plan in the transcript.
 * Supports two systems:
 *  - Task plugin (TaskCreate/TaskUpdate, event-sourced): reconstruct the list by
 *    folding creates (id = creation order) and status updates. Cancelled tasks
 *    are dropped.
 *  - Standard TodoWrite: the latest full list.
 * Reads the whole file (needs early TaskCreate events); falls back to tail-only
 * TodoWrite for very large transcripts. Never throws.
 */
export function readLatestTodos(path: string | null | undefined): TodoItem[] {
  if (!path) return [];
  try {
    const size = statSync(path).size;
    if (size > MAX_TODO_SCAN_BYTES) {
      // Too big to fully scan — best-effort TodoWrite from the tail only.
      let fd: number | null = null;
      try {
        fd = openSync(path, "r");
        const start = Math.max(0, size - TAIL_BYTES);
        const buf = Buffer.allocUnsafe(size - start);
        readSync(fd, buf, 0, size - start, start);
        let text = buf.toString("utf8");
        const nl = text.indexOf("\n");
        if (start > 0 && nl >= 0) text = text.slice(nl + 1);
        return latestTodoWrite(text.split("\n")) ?? [];
      } finally {
        if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
      }
    }

    const lines = readFileSync(path, "utf8").split("\n");
    // Reconstruct the Task-plugin list from creates + updates, in order.
    const tasks: Array<{ text: string; status: TodoItem["status"] | "cancelled" }> = [];
    let sawTask = false;
    for (const line of lines) {
      const t = line.trim();
      if (!t || (!t.includes("TaskCreate") && !t.includes("TaskUpdate"))) continue;
      let obj: TranscriptLine;
      try { obj = JSON.parse(t); } catch { continue; }
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type !== "tool_use") continue;
        if (b.name === "TaskCreate") {
          sawTask = true;
          const input = b.input as { subject?: unknown; content?: unknown; text?: unknown };
          const subj =
            typeof input?.subject === "string" ? input.subject :
            typeof input?.content === "string" ? input.content :
            typeof input?.text === "string" ? input.text : "";
          tasks.push({ text: subj ? subj.slice(0, 300) : `Task ${tasks.length + 1}`, status: "pending" });
        } else if (b.name === "TaskUpdate") {
          sawTask = true;
          const input = b.input as { taskId?: unknown; status?: unknown };
          const idx = Number.parseInt(String(input?.taskId ?? ""), 10) - 1;
          if (idx >= 0 && idx < tasks.length) tasks[idx].status = normStatus(input?.status);
        }
      }
    }
    if (sawTask) {
      return tasks.filter((t) => t.status !== "cancelled").map((t) => ({ text: t.text, status: t.status as TodoItem["status"] }));
    }
    // No Task plugin — try standard TodoWrite.
    return latestTodoWrite(lines) ?? [];
  } catch {
    return [];
  }
}

/**
 * The current context-window size (tokens) + model from the latest assistant turn.
 * Claude Code records per-turn `usage`; the context size is the total INPUT of the
 * last request = input_tokens + cache_read + cache_creation (output isn't context).
 * Tail-bounded; never throws.
 */
export function readLatestUsage(path: string | null | undefined): { contextTokens: number | null; model: string | null } {
  const empty = { contextTokens: null, model: null };
  if (!path) return empty;
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return empty;
    const buf = Buffer.allocUnsafe(length);
    readSync(fd, buf, 0, length, start);
    let text = buf.toString("utf8");
    if (start > 0) { const nl = text.indexOf("\n"); text = nl >= 0 ? text.slice(nl + 1) : ""; }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || !line.includes("usage")) continue;
      let obj: { message?: { role?: string; model?: string; usage?: Record<string, number> } };
      try { obj = JSON.parse(line); } catch { continue; }
      const u = obj.message?.usage;
      if (obj.message?.role !== "assistant" || !u) continue;
      const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      return { contextTokens: ctx > 0 ? ctx : null, model: obj.message?.model ?? null };
    }
    return empty;
  } catch {
    return empty;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * Cumulative token spend for the whole session: summed across every assistant turn,
 * `input` = input_tokens + cache_creation (fresh input we paid to process; cache
 * reads are excluded as ~free), `output` = output_tokens (what Claude generated).
 * Full (bounded) scan — call sparingly (on Stop, once per turn). Never throws.
 */
export function readTotalUsage(path: string | null | undefined): { tokensInput: number; tokensOutput: number } {
  const empty = { tokensInput: 0, tokensOutput: 0 };
  if (!path) return empty;
  try {
    const size = statSync(path).size;
    if (size > MAX_TODO_SCAN_BYTES) return empty; // too big to fully scan safely
    let input = 0, output = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes("usage")) continue;
      let obj: { message?: { role?: string; usage?: Record<string, number> } };
      try { obj = JSON.parse(line); } catch { continue; }
      const u = obj.message?.usage;
      if (obj.message?.role !== "assistant" || !u) continue;
      input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      output += u.output_tokens ?? 0;
    }
    return { tokensInput: input, tokensOutput: output };
  } catch {
    return empty;
  }
}

export function readLastAssistantText(path: string | null | undefined): string | null {
  if (!path) return null;
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return null;
    const buf = Buffer.allocUnsafe(length);
    readSync(fd, buf, 0, length, start);
    let text = buf.toString("utf8");
    // If we started mid-file, drop the leading partial line.
    if (start > 0) {
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : "";
    }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let obj: TranscriptLine;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type !== "assistant" && obj.message?.role !== "assistant") continue;
      const content = obj.message?.content;
      let prose = "";
      if (typeof content === "string") {
        prose = content;
      } else if (Array.isArray(content)) {
        prose = content
          .filter((b) => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n")
          .trim();
      }
      if (prose) return prose.slice(0, MAX_SUMMARY_CHARS);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}
