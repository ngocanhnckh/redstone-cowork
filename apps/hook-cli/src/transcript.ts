import { openSync, fstatSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
import type { TranscriptMessage, TodoItem } from "@rcw/shared";
import {
  MAX_TODO_SCAN_BYTES,
  TAIL_BYTES,
  latestTodoWrite,
  parseLastAssistantText,
  parseLatestTodos,
  parseLatestUsage,
  parseRecentMessages,
  sumUsage,
} from "@rcw/claude-core";

// ---------------------------------------------------------------------------
// File-reading shells over the pure parsers in @rcw/claude-core.
//
// The parsing logic lives in the shared package so the desktop's direct-SSH
// engine can run the SAME code over a transcript tail fetched through a pipe.
// Everything here is just "get the bytes" — every exported signature and its
// behaviour is unchanged from before the extraction.
//
// Never throws: callers run inside the hook handler, which must never break the
// user's Claude session.
// ---------------------------------------------------------------------------

export { MAX_SUMMARY_CHARS, MAX_ASSISTANT_CHARS } from "@rcw/claude-core";

/**
 * Read the last `TAIL_BYTES` of a file as UTF-8, dropping the leading partial line
 * when we started mid-file. Returns "" on any failure.
 */
function readTail(path: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return "";
    const buf = Buffer.allocUnsafe(length);
    readSync(fd, buf, 0, length, start);
    const text = buf.toString("utf8");
    if (start === 0) return text;
    const nl = text.indexOf("\n");
    return nl >= 0 ? text.slice(nl + 1) : "";
  } catch {
    return "";
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/** Recent user prompts + assistant prose from the transcript tail, oldest→newest,
 * capped at `limit` (the cockpit's scroll-back window — posted on every hook event,
 * so it's a rolling window of the tail, not the full on-disk history). */
export function readRecentMessages(path: string | null | undefined, limit = 150): TranscriptMessage[] {
  if (!path) return [];
  return parseRecentMessages(readTail(path), limit) as TranscriptMessage[];
}

/**
 * The session's current to-do list, from Claude's own plan in the transcript.
 * Reads the whole file (needs early TaskCreate events); falls back to tail-only
 * TodoWrite for very large transcripts. Never throws.
 */
export function readLatestTodos(path: string | null | undefined): TodoItem[] {
  if (!path) return [];
  try {
    const size = statSync(path).size;
    if (size > MAX_TODO_SCAN_BYTES) {
      // Too big to fully scan — best-effort TodoWrite from the tail only.
      return (latestTodoWrite(readTail(path).split("\n")) ?? []) as TodoItem[];
    }
    return parseLatestTodos(readFileSync(path, "utf8").split("\n")) as TodoItem[];
  } catch {
    return [];
  }
}

/**
 * The current context-window size (tokens) + model from the latest assistant turn.
 * Tail-bounded; never throws.
 */
export function readLatestUsage(path: string | null | undefined): { contextTokens: number | null; model: string | null } {
  if (!path) return { contextTokens: null, model: null };
  return parseLatestUsage(readTail(path));
}

/**
 * Cumulative token spend for the whole session. Full (bounded) scan — call
 * sparingly (on Stop, once per turn). Never throws.
 */
export function readTotalUsage(path: string | null | undefined): { tokensInput: number; tokensOutput: number } {
  const empty = { tokensInput: 0, tokensOutput: 0 };
  if (!path) return empty;
  try {
    if (statSync(path).size > MAX_TODO_SCAN_BYTES) return empty; // too big to fully scan safely
    return sumUsage(readFileSync(path, "utf8").split("\n"));
  } catch {
    return empty;
  }
}

/**
 * The most recent assistant *text* the user saw. Tool-use-only turns are skipped.
 * Tail-bounded; never throws.
 */
export function readLastAssistantText(path: string | null | undefined): string | null {
  if (!path) return null;
  return parseLastAssistantText(readTail(path));
}
