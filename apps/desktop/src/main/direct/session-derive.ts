import { parseMarkers, parseTranscriptHead, type TranscriptMarkers } from "@rcw/claude-core";

// ---------------------------------------------------------------------------
// Turning raw host facts into sessions, with no agent and no hooks installed.
//
// Everything here is PURE — facts in, sessions out — so the interesting parts
// (correlation, "is Claude working", "did a turn just end") are testable without a
// host, an SSH connection, or a running Claude.
//
// The hosted edition learns all of this from Claude Code hooks pushing events to the
// server. We recover it from what Claude Code already writes to disk, which turns out
// to carry MORE than the hook path does (see parseMarkers in @rcw/claude-core).
// ---------------------------------------------------------------------------

/** One `~/.claude/projects/<dir>/<id>.jsonl`, as reported by `sessions.scan`. */
export type ScannedFile = {
  path: string;
  id: string;
  dir: string;
  size: number;
  mtimeMs: number;
  /** Age computed against the REMOTE clock — never remote mtime vs local now. */
  ageMs: number;
};

/** One tmux pane, as reported by `tmux.list`. */
export type Pane = {
  session: string;
  window: number;
  pane: number;
  pid: number;
  cwd: string;
  /** The pane's FOREGROUND command — often the wrapper shell, not Claude itself. */
  command: string;
  createdAt: number;
  attached: boolean;
  /** Claude found anywhere in the pane's process subtree, resolved by the probe. */
  claudePid?: number | null;
  claudeArgs?: string | null;
  /** The id from `claude --resume <id>`, when the process was started that way. */
  resumeId?: string | null;
};

export type SessionFacts = {
  id: string;
  cwd: string;
  path: string;
  title: string | null;
  sizeBytes: number;
  mtimeMs: number;
  ageMs: number;
  /** A live tmux pane is running Claude for this transcript. */
  live: boolean;
  tmuxSession: string | null;
  /** `session:window.pane` — the target for send-keys / capture-pane. */
  paneTarget: string | null;
  /** Set when the session was launched by the cockpit wrapper (`rcw-<id>`). */
  wrapperId: string | null;
  attached: boolean;
};

/**
 * Is Claude running in this pane?
 *
 * The probe resolves this from the pane's process SUBTREE, because
 * `pane_current_command` reports only the foreground process — and the cockpit's own
 * wrapper launches Claude inside a shell command string, so those panes read as
 * `bash`. Matching the pane command alone silently misses every wrapper-launched
 * session. The command check is only a fallback for probes that predate `claudePid`.
 */
export function isClaudePane(p: Pane): boolean {
  if (p.claudePid != null) return true;
  if (p.claudePid === null) return false; // probe looked and found nothing
  return /(^|\/)claude(\s|$)?/i.test(p.command.trim());
}

/** `rcw-4e59c7ee` → `4e59c7ee`; anything else → null. */
export function wrapperIdOf(tmuxSession: string): string | null {
  const m = /^rcw-([0-9a-f]+)$/i.exec(tmuxSession);
  return m ? m[1] : null;
}

const paneTarget = (p: Pane): string => `${p.session}:${p.window}.${p.pane}`;

/**
 * Correlate transcripts with tmux panes.
 *
 * A transcript's real cwd is read out of its own head — the project directory name is
 * a lossy slug (both `/` and `.` become `-`) and cannot be reversed. A pane is matched
 * to the NEWEST transcript sharing its cwd, which is what `claude --resume` in the same
 * folder produces.
 *
 * Panes with no Claude process are ignored, but transcripts with no pane are KEPT: those
 * are resumable conversations, and the cockpit already renders them (status "lost").
 */
export function correlate(
  files: ScannedFile[],
  heads: Record<string, string>,
  panes: Pane[],
): SessionFacts[] {
  const byPath = new Map<string, { cwd: string; title: string | null }>();
  for (const f of files) {
    const head = heads[f.path];
    if (head === undefined) continue; // head not fetched yet — skip this round
    const { cwd, title } = parseTranscriptHead(head);
    if (!cwd) continue; // can't place it in a folder
    byPath.set(f.path, { cwd, title });
  }

  // Newest transcript first, so the first match per cwd is the live one.
  const ordered = files
    .filter((f) => byPath.has(f.path))
    .slice()
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const claudePanes = panes.filter(isClaudePane);
  const claimed = new Set<string>();
  const out: SessionFacts[] = [];

  for (const f of ordered) {
    const meta = byPath.get(f.path)!;
    // `claude --resume <id>` names the transcript outright — always prefer it over
    // guessing by directory, which is only a heuristic and gets ambiguous with two
    // Claudes in one folder.
    const byResume = claudePanes.find((p) => p.resumeId === f.id && !claimed.has(paneTarget(p)));
    const pane = byResume ?? claudePanes.find((p) => !p.resumeId && p.cwd === meta.cwd && !claimed.has(paneTarget(p)));
    if (pane) claimed.add(paneTarget(pane));
    out.push({
      id: f.id,
      cwd: meta.cwd,
      path: f.path,
      title: meta.title,
      sizeBytes: f.size,
      mtimeMs: f.mtimeMs,
      ageMs: f.ageMs,
      live: !!pane,
      tmuxSession: pane ? pane.session : null,
      paneTarget: pane ? paneTarget(pane) : null,
      wrapperId: pane ? wrapperIdOf(pane.session) : null,
      attached: pane ? pane.attached : false,
    });
  }
  return out;
}

// --- state derivation -------------------------------------------------------

/**
 * Claude has been idle this long → it is definitively not working, whatever the
 * transcript's last line looks like. Mirrors the hosted poller's own backstop.
 */
export const IDLE_BACKSTOP_MS = 45_000;

/**
 * A turn isn't "over" the instant a text block lands — Claude routinely writes prose
 * and then immediately starts another tool call. Waiting a beat stops `working` from
 * flapping true/false several times inside one turn.
 */
export const TURN_SETTLE_MS = 2_500;

/** An unresolved tool call older than this is probably blocked on a prompt. */
export const PROMPT_SUSPECT_MS = 4_000;

type Block = { type?: string; text?: string; name?: string; input?: unknown; id?: string; tool_use_id?: string };
type Line = { type?: string; message?: { role?: string; content?: Block[] | string; stop_reason?: string } };

export type PendingTool = { id: string | null; name: string; input: unknown };

export type DerivedState = {
  working: boolean;
  /** A tool call Claude issued that has no result yet — it's running, or blocked on you. */
  pendingTool: PendingTool | null;
  /** True when the last assistant turn ended cleanly (`end_turn`). */
  turnEnded: boolean;
  markers: TranscriptMarkers;
};

/**
 * Work out what Claude is doing from the transcript tail plus how stale the file is.
 *
 * The signals, in the order they're trusted:
 *   1. An unmatched `tool_use` → a tool is running (or waiting on a permission prompt).
 *   2. A trailing user turn with no assistant reply → Claude is thinking.
 *   3. `stop_reason: "end_turn"` on the last assistant turn → the turn is over.
 *   4. Staleness → whatever the text says, an untouched file means nothing is happening.
 *
 * For comparison the hosted edition's `working` is just
 * `event === "UserPromptSubmit" || event === "PostToolUse"` — this is strictly richer.
 */
export function deriveState(tailText: string, ageMs: number): DerivedState {
  const markers = parseMarkers(tailText);
  const lines: Line[] = [];
  for (const raw of tailText.split("\n")) {
    const t = raw.trim();
    if (!t || t[0] !== "{") continue;
    try { lines.push(JSON.parse(t) as Line); } catch { /* half-written line */ }
  }

  // Match tool calls to their results by id. A result can arrive many lines later.
  const resolved = new Set<string>();
  for (const l of lines) {
    const c = l.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type === "tool_result" && typeof b.tool_use_id === "string") resolved.add(b.tool_use_id);
    }
  }

  let pendingTool: PendingTool | null = null;
  let lastRole: "user" | "assistant" | null = null;
  let turnEnded = false;

  for (const l of lines) {
    const role = l.message?.role ?? (l.type === "assistant" ? "assistant" : l.type === "user" ? "user" : null);
    if (role !== "assistant" && role !== "user") continue;
    lastRole = role;
    const c = l.message?.content;
    if (role === "assistant") {
      turnEnded = l.message?.stop_reason === "end_turn";
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== "tool_use" || typeof b.name !== "string") continue;
          const id = typeof b.id === "string" ? b.id : null;
          // Unresolved → still outstanding. Later calls supersede earlier ones.
          if (!id || !resolved.has(id)) pendingTool = { id, name: b.name, input: b.input };
          else if (pendingTool && pendingTool.id === id) pendingTool = null;
        }
      }
    } else if (Array.isArray(c)) {
      // A tool_result clears the call it answers.
      for (const b of c) {
        if (b?.type === "tool_result" && pendingTool && b.tool_use_id === pendingTool.id) pendingTool = null;
      }
    }
  }

  // A stale file means nothing is running, regardless of what the text implies. Without
  // this a session whose Claude was killed mid-tool would show "working" forever.
  if (ageMs > IDLE_BACKSTOP_MS) {
    return { working: false, pendingTool, turnEnded, markers };
  }

  let working: boolean;
  if (pendingTool) working = true;
  else if (lastRole === "user") working = true;          // prompt submitted, no reply yet
  else if (turnEnded) working = ageMs < TURN_SETTLE_MS;  // settle before declaring it done
  else working = ageMs < TURN_SETTLE_MS;

  return { working, pendingTool, turnEnded, markers };
}

/**
 * Whether a pending tool has been outstanding long enough to be a prompt rather than a
 * slow command. `AskUserQuestion` is exempt: it is unambiguous the moment it appears,
 * because Claude cannot proceed without an answer.
 */
export function isBlockedOnUser(state: DerivedState, ageMs: number): boolean {
  if (!state.pendingTool) return false;
  if (state.pendingTool.name === "AskUserQuestion") return true;
  return ageMs >= PROMPT_SUSPECT_MS;
}
