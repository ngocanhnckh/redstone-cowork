import {
  parseLastAssistantText,
  parseLatestTodos,
  parseLatestUsage,
  parseRecentMessages,
  type TodoItem,
  type TranscriptMessage,
} from "@rcw/claude-core";
import { correlate, deriveState, isBlockedOnUser, type Pane, type ScannedFile, type SessionFacts } from "./session-derive";
import type { ProbeChannel } from "./probe-channel";

// ---------------------------------------------------------------------------
// One host's sessions, assembled over the probe channel.
//
// This is the offline edition's replacement for everything the hosted stack does
// between a Claude Code hook firing and `GET /sessions` returning: discovery,
// transcript sync, state, todos, token spend. There is no agent on the host and no
// server in the path — just stat, byte-range reads, and the shared parsers.
//
// Cost discipline matters, because this runs on a timer:
//   * `sessions.scan` is stat-only — no file contents.
//   * Heads are read ONCE per transcript ever (the head never changes).
//   * Tails are read as deltas from the last offset, so a quiet session costs nothing.
//   * `transcript.reduce` (a full-file scan for token totals) runs only when a turn
//     ends, matching the hosted agent, which does it only on `Stop`.
// ---------------------------------------------------------------------------

/** Only sessions touched this recently get their transcript read. */
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h
/** Hard cap on transcripts tailed per refresh, newest first. */
const MAX_TAILED = 24;
/** How much of a transcript to pull on first sight. Matches @rcw/claude-core's TAIL_BYTES. */
const FIRST_TAIL_BYTES = 768 * 1024;
/** Keep the in-memory tail bounded as deltas append to it. */
const MAX_TAIL_CHARS = 1_500_000;

export type SessionStatus = "active" | "waiting" | "stale" | "lost";

/** Shaped to match the renderer's SessionView so the cockpit needs no changes. */
export type DirectSession = {
  id: string;
  machine: string;
  cwd: string;
  gitBranch: string | null;
  wrapperId: string | null;
  status: SessionStatus;
  pendingDecisions: number;
  waitingSince: string | null;
  latestAnswer: string | null;
  summary: string | null;
  todos: TodoItem[];
  userTodos: never[];
  tags: string[];
  transcript: TranscriptMessage[];
  working: boolean;
  contextTokens: number | null;
  model: string | null;
  tokensInput: number;
  tokensOutput: number;
  tokenSeries: { t: string; input: number; output: number }[];
  pinned: boolean;
  snoozedUntil: string | null;
  lastSeenAt: string | null;
  attachedAt: string | null;
  permissionMode: string | null;
  autoModeEnabled: boolean;
  /** Direct-edition extras the cockpit ignores but the engine needs. */
  paneTarget: string | null;
  live: boolean;
  transcriptPath: string;
};

type Cached = {
  head?: string;
  tail: string;
  offset: number | null;
  tokensInput: number;
  tokensOutput: number;
  todos: TodoItem[];
  /** Size at the last `transcript.reduce`, so we only rescan when a turn actually ended. */
  reducedAtSize: number;
  lastTurnEnded: boolean;
};

export class SessionEngine {
  private cache = new Map<string, Cached>();

  constructor(private channel: ProbeChannel, private machine: string) {}

  /** Drop cached state for transcripts that no longer exist, so memory can't creep. */
  private prune(alive: Set<string>): void {
    for (const path of [...this.cache.keys()]) if (!alive.has(path)) this.cache.delete(path);
  }

  async refresh(): Promise<DirectSession[]> {
    const [scan, tmux] = await Promise.all([
      this.channel.request<{ files: ScannedFile[]; now: number }>("sessions.scan", { limit: 300 }, 30_000),
      this.channel.request<{ panes: Pane[]; running: boolean }>("tmux.list"),
    ]);

    const alive = new Set(scan.files.map((f) => f.path));
    this.prune(alive);

    // Heads never change, so fetch each exactly once — for a host with 200 transcripts
    // this is one 200-file read on first connect and nothing thereafter.
    const missing = scan.files.filter((f) => !this.cache.get(f.path)?.head).map((f) => f.path);
    const heads: Record<string, string> = {};
    for (const [path, c] of this.cache) if (c.head) heads[path] = c.head;
    if (missing.length) {
      const r = await this.channel.request<{ heads: Record<string, string> }>(
        "transcript.head", { paths: missing.slice(0, 200), bytes: 16 * 1024 }, 60_000,
      );
      for (const [path, head] of Object.entries(r.heads)) {
        heads[path] = head;
        this.entry(path).head = head;
      }
    }

    const facts = correlate(scan.files, heads, tmux.panes);

    // Read transcripts only where something might have changed.
    const worth = facts
      .filter((f) => f.live || f.ageMs < ACTIVE_WINDOW_MS)
      .slice(0, MAX_TAILED);

    const sessions: DirectSession[] = [];
    for (const f of worth) {
      try {
        sessions.push(await this.build(f));
      } catch {
        // One unreadable transcript must not blank the whole cockpit.
      }
    }
    return sessions;
  }

  private entry(path: string): Cached {
    let c = this.cache.get(path);
    if (!c) {
      c = { tail: "", offset: null, tokensInput: 0, tokensOutput: 0, todos: [], reducedAtSize: -1, lastTurnEnded: false };
      this.cache.set(path, c);
    }
    return c;
  }

  private async build(f: SessionFacts): Promise<DirectSession> {
    const c = this.entry(f.path);

    // Delta read: only bytes appended since last time. `reset` means the file was
    // rotated or rewritten, so the buffer we hold no longer belongs to it.
    const tail = await this.channel.request<{ text: string; size: number; offset: number; reset: boolean }>(
      "transcript.tail",
      c.offset === null
        ? { path: f.path, bytes: FIRST_TAIL_BYTES }
        : { path: f.path, fromOffset: c.offset, bytes: FIRST_TAIL_BYTES },
      30_000,
    );
    if (tail.reset || c.offset === null) c.tail = tail.text;
    else c.tail += tail.text;
    if (c.tail.length > MAX_TAIL_CHARS) c.tail = c.tail.slice(-MAX_TAIL_CHARS);
    c.offset = tail.offset;

    const state = deriveState(c.tail, f.ageMs);
    const usage = parseLatestUsage(c.tail);

    // Token totals and the Task-plugin todo fold both need the WHOLE file. Do it only
    // when a turn has just ended (same cadence as the hosted agent's `Stop` hook),
    // never on every tick.
    const turnJustEnded = state.turnEnded && !c.lastTurnEnded;
    c.lastTurnEnded = state.turnEnded;
    if (c.reducedAtSize < 0 || (turnJustEnded && tail.size !== c.reducedAtSize)) {
      try {
        const red = await this.channel.request<{
          tokensInput: number; tokensOutput: number; todoLines: string[]; scanned: boolean;
        }>("transcript.reduce", { path: f.path }, 120_000);
        if (red.scanned) {
          c.tokensInput = red.tokensInput;
          c.tokensOutput = red.tokensOutput;
          // Python only FILTERED the candidate lines; the event-sourced fold stays in
          // shared code so both editions build the same list.
          c.todos = parseLatestTodos(red.todoLines);
        }
        c.reducedAtSize = tail.size;
      } catch {
        // A reduce failure costs accuracy on one counter, not the session.
      }
    }

    const blocked = isBlockedOnUser(state, f.ageMs);
    const status: SessionStatus = !f.live
      ? "lost"
      : blocked ? "waiting"
      : state.working ? "active"
      : f.ageMs > ACTIVE_WINDOW_MS ? "stale" : "active";

    const nowIso = new Date().toISOString();
    return {
      id: f.id,
      machine: this.machine,
      cwd: f.cwd,
      gitBranch: null,
      wrapperId: f.wrapperId,
      status,
      pendingDecisions: blocked ? 1 : 0,
      waitingSince: blocked ? new Date(Date.now() - f.ageMs).toISOString() : null,
      latestAnswer: parseLastAssistantText(c.tail),
      // Claude Code writes its own rolling summary; the hosted edition pays an LLM for one.
      summary: state.markers.awaySummary ?? state.markers.aiTitle ?? f.title,
      todos: c.todos,
      userTodos: [],
      tags: [],
      transcript: parseRecentMessages(c.tail),
      working: state.working,
      contextTokens: usage.contextTokens,
      model: usage.model,
      tokensInput: c.tokensInput,
      tokensOutput: c.tokensOutput,
      tokenSeries: [],
      pinned: false,
      snoozedUntil: null,
      lastSeenAt: new Date(f.mtimeMs).toISOString(),
      attachedAt: nowIso,
      permissionMode: state.markers.permissionMode,
      autoModeEnabled: false,
      paneTarget: f.paneTarget,
      live: f.live,
      transcriptPath: f.path,
    };
  }
}
