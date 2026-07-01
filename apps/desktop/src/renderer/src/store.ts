import { create } from "zustand";
import { SessionView, Decision } from "./types";
import { pickFocus, nextAfterAnswer } from "./autoAdvance";

/**
 * A reply shown instantly in the timeline before the host echoes it back. We
 * snapshot the session's transcript length at send time (`baseLen`); once the
 * transcript grows past that, the host has incorporated the message and the
 * optimistic copy is dropped. This is robust to the host rewriting the text
 * (chunking / trimming) — unlike matching on the exact string, which used to
 * leave the bubble stuck until a TTL.
 */
export type PendingSend = { text: string; baseLen: number; ts: number };

/** Safety net: drop an un-incorporated optimistic send after this long (ms). */
const PENDING_TTL_MS = 60 * 1000;

/** Current transcript length for a session, looking across both sessions and queue. */
function transcriptLen(sessions: SessionView[], queue: SessionView[], id: string): number {
  const s = sessions.find((x) => x.id === id) ?? queue.find((x) => x.id === id);
  return s?.transcript?.length ?? 0;
}

/** Drop optimistic sends the host has incorporated (transcript grew past baseLen) or that aged out. */
function prunePending(
  pending: Record<string, PendingSend[]>,
  sessions: SessionView[],
  queue: SessionView[],
  now: number
): Record<string, PendingSend[]> {
  const next: Record<string, PendingSend[]> = {};
  for (const [id, list] of Object.entries(pending)) {
    const len = transcriptLen(sessions, queue, id);
    const kept = list.filter((p) => now - p.ts < PENDING_TTL_MS && len <= p.baseLen);
    if (kept.length) next[id] = kept;
  }
  return next;
}

type State = {
  sessions: SessionView[];
  queue: SessionView[];
  decisions: Decision[];
  focusId: string | null;
  mode: "flow" | "grid";
  detailId: string | null; // session shown in the grid's drill-in detail
  pending: Record<string, PendingSend[]>; // sessionId → optimistic sends, shown instantly
  activeTab: Record<string, "chat" | "terminal" | "browser" | "ports" | "files">; // sessionId → active workspace tab
  contextCollapsed: boolean; // right context sidebar collapsed (more room for the body)
  assistOpen: boolean; // LLM assistant slide-over
  settingsOpen: boolean; // connection settings modal
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setActiveTab: (sessionId: string, tab: "chat" | "terminal" | "browser" | "ports" | "files") => void;
  toggleContext: () => void;
  toggleAssist: () => void;
  toggleSettings: () => void;
  setFocus: (id: string) => void;
  setMode: (mode: "flow" | "grid") => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  recordSent: (sessionId: string, text: string) => void;
  answer: (
    decisionId: string,
    resolution: { choice?: string | null; answers?: null; custom?: string | null }
  ) => Promise<void>;
  snooze: (sessionId: string, minutes: number) => Promise<void>;
  pin: (sessionId: string, pinned: boolean) => Promise<void>;
  instruct: (sessionId: string, text: string) => Promise<void>;
  switchMode: (sessionId: string, mode: string) => Promise<void>;
};

export const useStore = create<State>((set, get) => ({
  sessions: [],
  queue: [],
  decisions: [],
  focusId: null,
  mode: "flow",
  detailId: null,
  pending: {},
  activeTab: {},
  contextCollapsed: false,
  assistOpen: false,
  settingsOpen: false,
  loading: false,
  error: null,

  setActiveTab: (sessionId, tab) => {
    set((state) => ({ activeTab: { ...state.activeTab, [sessionId]: tab } }));
  },

  toggleContext: () => set((state) => ({ contextCollapsed: !state.contextCollapsed })),

  toggleAssist: () => set((state) => ({ assistOpen: !state.assistOpen })),

  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),

  refresh: async () => {
    try {
      const [queue, sessions, decisions] = await Promise.all([
        window.cowork.getQueue(),
        window.cowork.getSessions(),
        window.cowork.getPendingDecisions(),
      ]);
      const q = queue as SessionView[];
      const s = sessions as SessionView[];
      const d = decisions as Decision[];
      set((state) => ({
        queue: q,
        sessions: s,
        decisions: d,
        focusId: pickFocus(q, s, state.focusId),
        pending: prunePending(state.pending, s, q, Date.now()),
        error: null,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  recordSent: (sessionId, text) => {
    const t = text.trim();
    if (!t) return;
    set((state) => {
      const existing = state.pending[sessionId] ?? [];
      // Snapshot transcript length + already-queued sends, so multiple quick sends
      // each clear in order as the host incorporates them one at a time.
      const baseLen = transcriptLen(state.sessions, state.queue, sessionId) + existing.length;
      return {
        pending: {
          ...state.pending,
          [sessionId]: [...existing, { text: t, baseLen, ts: Date.now() }],
        },
      };
    });
  },

  setFocus: (id: string) => {
    set({ focusId: id });
  },

  setMode: (mode: "flow" | "grid") => {
    set({ mode, detailId: null });
  },

  openDetail: (id: string) => {
    set({ detailId: id });
  },

  closeDetail: () => {
    set({ detailId: null });
  },

  answer: async (
    decisionId: string,
    resolution: { choice?: string | null; answers?: null; custom?: string | null }
  ) => {
    try {
      const sessionId = get().decisions.find((d) => d.id === decisionId)?.sessionId ?? null;
      // A custom free-text reply travels back like an instruction — show it instantly.
      if (sessionId && resolution.custom) get().recordSent(sessionId, resolution.custom);
      await window.cowork.resolveDecision(decisionId, {
        choice: null,
        answers: null,
        custom: null,
        ...resolution,
      });
      const next = sessionId ? nextAfterAnswer(get().queue, sessionId) : null;
      if (next) set({ focusId: next });
      await get().refresh();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  snooze: async (sessionId: string, minutes: number) => {
    await window.cowork.snooze(sessionId, minutes);
    await get().refresh();
  },

  pin: async (sessionId: string, pinned: boolean) => {
    await window.cowork.pin(sessionId, pinned);
    await get().refresh();
  },

  instruct: async (sessionId, text) => {
    try {
      get().recordSent(sessionId, text);
      // In Flow mode, advance to the next non-busy session on the queue — skipping
      // the one we just messaged (now busy) and any session actively working — so
      // the user keeps moving through what needs their attention. Prefer a session
      // with an actionable decision (a real question/permission), but fall back to
      // any other waiting session rather than getting stuck on the one we just sent.
      const { mode, queue, decisions } = get();
      let next: string | null = null;
      if (mode === "flow") {
        const ACTIONABLE = new Set(["question", "permission", "mode"]);
        const needsInput = new Set(
          decisions.filter((d) => ACTIONABLE.has(d.kind)).map((d) => d.sessionId)
        );
        const candidates = queue.filter((q) => q.id !== sessionId && !q.working);
        next = candidates.find((q) => needsInput.has(q.id))?.id ?? candidates[0]?.id ?? null;
      }
      await window.cowork.instruct(sessionId, text);
      if (next) set({ focusId: next });
      await get().refresh();
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  switchMode: async (sessionId, mode) => {
    try { await window.cowork.switchMode(sessionId, mode); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },
}));

export function startCockpit(): () => void {
  useStore.getState().refresh();
  const unsub = window.cowork.onUpdate(() => useStore.getState().refresh());
  return unsub;
}
