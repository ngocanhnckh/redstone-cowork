import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// The only session state that must survive a restart.
//
// Almost everything the hosted edition keeps in Postgres is DERIVED from the host —
// session existence, cwd, transcript, todos, working, context, tokens — and is
// recomputed on every connect. What can't be recovered is user intent: which sessions
// you pinned, snoozed, tagged or dismissed, and which answers you've already been
// notified about.
//
// That's well under a megabyte with no query requirements, so it's one atomic JSON
// document rather than SQLite: better-sqlite3 would add a native module and a
// per-platform Electron ABI rebuild, and electron-builder.yml sets `npmRebuild: false`
// specifically so no target needs a C++ toolchain. Four other stores in userData
// already follow this shape.
// ---------------------------------------------------------------------------

export type SessionIntent = {
  tags: string[];
  userTodos: { id: string; text: string; done: boolean }[];
  pinned: boolean;
  snoozedUntil: string | null;
  closedAt: string | null;
  /** First time we saw this session, so "attached at" survives restarts. */
  firstSeenAt: string;
  /** Last answer we raised a notification for, to avoid re-notifying on restart. */
  lastNotifiedAnswer: string | null;
};

type Stored = {
  v: 1;
  sessions: Record<string, SessionIntent>;
  /** Resolved decision signatures, so an answered card can't reappear before the
   *  host reflects the answer. Value is the epoch ms it was resolved. */
  resolved: Record<string, number>;
};

/** How long a resolved decision stays suppressed. */
const RESOLVED_TTL_MS = 10 * 60 * 1000;
/** Forget sessions untouched for this long, so the file can't creep forever. */
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const storePath = (): string => path.join(app.getPath("userData"), "direct-state.json");

let cache: Stored | null = null;
let flushTimer: NodeJS.Timeout | null = null;

function load(): Stored {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Stored;
    if (raw && raw.v === 1 && raw.sessions) {
      cache = { v: 1, sessions: raw.sessions, resolved: raw.resolved ?? {} };
      return cache;
    }
  } catch {
    // no store yet, or garbage — start clean
  }
  cache = { v: 1, sessions: {}, resolved: {} };
  return cache;
}

function flush(): void {
  if (!cache) return;
  try {
    const p = storePath();
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf8");
    fs.renameSync(tmp, p); // atomic — a crash mid-write can't truncate the store
  } catch {
    // best-effort; losing a pin is not worth throwing across IPC
  }
}

/** Debounced write. Bursts of tag/pin edits shouldn't each hit the disk. */
function save(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 500);
}

/** Call on app quit so a pending debounce isn't lost. */
export function flushNow(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flush();
}

export function intentFor(sessionId: string): SessionIntent {
  const s = load();
  let it = s.sessions[sessionId];
  if (!it) {
    it = {
      tags: [], userTodos: [], pinned: false, snoozedUntil: null, closedAt: null,
      firstSeenAt: new Date().toISOString(), lastNotifiedAnswer: null,
    };
    s.sessions[sessionId] = it;
    save();
  }
  return it;
}

export function updateIntent(sessionId: string, patch: Partial<SessionIntent>): SessionIntent {
  const it = intentFor(sessionId);
  Object.assign(it, patch);
  save();
  return it;
}

/** True while a decision with this signature is still suppressed. */
export function isResolved(signature: string): boolean {
  const s = load();
  const at = s.resolved[signature];
  if (!at) return false;
  if (Date.now() - at > RESOLVED_TTL_MS) {
    delete s.resolved[signature];
    save();
    return false;
  }
  return true;
}

export function markResolved(signature: string): void {
  const s = load();
  s.resolved[signature] = Date.now();
  save();
}

/** Drop state for sessions that haven't been seen in a long time. */
export function prune(liveIds: Set<string>): void {
  const s = load();
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  let changed = false;
  for (const [id, it] of Object.entries(s.sessions)) {
    if (liveIds.has(id)) continue;
    if (Date.parse(it.firstSeenAt) < cutoff) { delete s.sessions[id]; changed = true; }
  }
  for (const [sig, at] of Object.entries(s.resolved)) {
    if (Date.now() - at > RESOLVED_TTL_MS) { delete s.resolved[sig]; changed = true; }
  }
  if (changed) save();
}

/** Test seam — resets the in-memory cache. */
export function _resetForTest(): void {
  cache = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
