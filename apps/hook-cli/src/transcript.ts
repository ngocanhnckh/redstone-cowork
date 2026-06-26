import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import type { TranscriptMessage } from "@rcw/shared";

/** Cap stored message length — enough to read on expand, small enough not to bloat the payload/DB. */
export const MAX_SUMMARY_CHARS = 2000;

/** Only scan the tail of the transcript; the last assistant prose is always near the end. */
const TAIL_BYTES = 256 * 1024;

type ContentBlock = { type?: string; text?: string };
type TranscriptLine = { type?: string; message?: { role?: string; content?: ContentBlock[] | string } };

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
/** Recent user prompts + assistant prose from the transcript tail, oldest→newest, capped at `limit`. */
export function readRecentMessages(path: string | null | undefined, limit = 40): TranscriptMessage[] {
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
      const role = obj.message?.role ?? (obj.type === "assistant" ? "assistant" : obj.type === "user" ? "user" : undefined);
      if (role !== "assistant" && role !== "user") continue;
      const content = obj.message?.content;
      let prose = "";
      if (typeof content === "string") prose = content;
      else if (Array.isArray(content)) {
        prose = content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text!).join("\n").trim();
      }
      if (!prose) continue; // skip tool-only turns (tool_use / tool_result)
      out.push({ role: role as "user" | "assistant", text: prose.slice(0, MAX_SUMMARY_CHARS) });
    }
    return out.slice(-limit);
  } catch {
    return [];
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
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
