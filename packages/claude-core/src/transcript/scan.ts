// Pure helpers for locating and identifying Claude Code transcripts.
// Extracted from apps/hook-cli/src/scanner.ts so the desktop can apply the same
// logic to a directory listing fetched over SSH.

/**
 * The directory name Claude Code uses for a project under `~/.claude/projects`.
 *
 * Claude slugifies the cwd by replacing BOTH `/` and `.` with `-`. This is lossy
 * (and therefore not reversible — to recover a real cwd you must read it out of a
 * transcript's `cwd` field).
 *
 * NOTE: `apps/hook-cli/src/scanner.ts:newestTranscript` historically replaced only
 * `/`, so any cwd containing a dot (`~/src/foo.bar`, a versioned dir, a dotfile
 * directory) silently failed to resolve. `host-sessions.ts` had it right. This is
 * the correct encoding; `newestTranscript` now uses it.
 */
export function projectSlug(cwd: string): string {
  let out = "";
  for (const ch of cwd) out += ch === "/" || ch === "." ? "-" : ch;
  return out;
}

/**
 * Extract cwd + a title from the head of a transcript. The cwd is read from the
 * first line that carries a `cwd` field (the folder slug is lossy, so we don't
 * un-slug). The title is the first user message's text, truncated.
 */
export function parseTranscriptHead(head: string): { cwd: string | null; title: string | null } {
  let cwd: string | null = null;
  let title: string | null = null;
  for (const line of head.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: { cwd?: unknown; message?: { role?: string; content?: unknown }; type?: string };
    try { obj = JSON.parse(t); } catch { continue; }
    if (!cwd && typeof obj.cwd === "string") cwd = obj.cwd;
    if (!title) {
      const role = obj.message?.role ?? obj.type;
      if (role === "user") {
        const c = obj.message?.content;
        let text = "";
        if (typeof c === "string") text = c;
        else if (Array.isArray(c)) {
          const block = c.find((b: { type?: string; text?: string }) => b?.type === "text" && typeof b.text === "string");
          text = block?.text ?? "";
        }
        text = text.trim();
        // Skip tool-result / command noise; take the first real prompt.
        if (text && !text.startsWith("<")) title = text.slice(0, 120);
      }
    }
    if (cwd && title) break;
  }
  return { cwd, title };
}

/**
 * Marker lines Claude Code writes alongside the conversation. These are how the
 * direct (agent-free) edition recovers session metadata that the hosted edition
 * gets from hooks — verified against a live transcript:
 *
 *   {"type":"ai-title","aiTitle":"…"}
 *   {"type":"last-prompt","lastPrompt":"…"}
 *   {"type":"mode","mode":"normal"}
 *   {"type":"permission-mode","permissionMode":"bypassPermissions"}
 *   {"type":"system","subtype":"away_summary","content":"…"}
 *   {"type":"system","subtype":"turn_duration","durationMs":87411}
 */
export type TranscriptMarkers = {
  aiTitle: string | null;
  lastPrompt: string | null;
  mode: string | null;
  permissionMode: string | null;
  awaySummary: string | null;
  /** Milliseconds of the most recent completed turn, when recorded. */
  lastTurnDurationMs: number | null;
};

/** Scan transcript text for the newest value of each marker. Never throws. */
export function parseMarkers(text: string): TranscriptMarkers {
  const out: TranscriptMarkers = {
    aiTitle: null,
    lastPrompt: null,
    mode: null,
    permissionMode: null,
    awaySummary: null,
    lastTurnDurationMs: null,
  };
  try {
    const lines = text.split("\n");
    // Walk backwards — the newest value of each marker wins, and most sessions
    // write these near the end of every turn.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line.indexOf('"type"') < 0) continue;
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line); } catch { continue; }
      switch (obj.type) {
        case "ai-title":
          if (out.aiTitle === null && typeof obj.aiTitle === "string") out.aiTitle = obj.aiTitle;
          break;
        case "last-prompt":
          if (out.lastPrompt === null && typeof obj.lastPrompt === "string") out.lastPrompt = obj.lastPrompt;
          break;
        case "mode":
          if (out.mode === null && typeof obj.mode === "string") out.mode = obj.mode;
          break;
        case "permission-mode":
          if (out.permissionMode === null && typeof obj.permissionMode === "string") out.permissionMode = obj.permissionMode;
          break;
        case "system":
          if (obj.subtype === "away_summary" && out.awaySummary === null && typeof obj.content === "string") {
            out.awaySummary = obj.content;
          } else if (obj.subtype === "turn_duration" && out.lastTurnDurationMs === null && typeof obj.durationMs === "number") {
            out.lastTurnDurationMs = obj.durationMs;
          }
          break;
      }
    }
  } catch {
    // best-effort — markers are additive metadata, never load-bearing
  }
  return out;
}
