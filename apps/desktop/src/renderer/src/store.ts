import { create } from "zustand";
import { SessionView, Decision } from "./types";
import { pickFocus, nextAfterAnswer } from "./autoAdvance";

/** A reply the user just sent, shown optimistically until the server transcript echoes it back. */
export type PendingSend = { text: string; ts: number };

/** Drop a pending send once the server transcript carries the same user text, or after this TTL (ms) as a safety net. */
const PENDING_TTL_MS = 5 * 60 * 1000;

type State = {
  sessions: SessionView[];
  queue: SessionView[];
  decisions: Decision[];
  focusId: string | null;
  mode: "flow" | "grid";
  detailId: string | null; // session shown in the grid's drill-in detail
  pending: Record<string, PendingSend[]>; // sessionId → optimistic sent messages
  activeTab: Record<string, "chat" | "terminal" | "browser">; // sessionId → active workspace tab
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setActiveTab: (sessionId: string, tab: "chat" | "terminal" | "browser") => void;
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

/** Remove pending sends that the server transcript now echoes (user typed it through), or that have aged out. */
function prunePending(
  pending: Record<string, PendingSend[]>,
  sessions: SessionView[],
  now: number
): Record<string, PendingSend[]> {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const next: Record<string, PendingSend[]> = {};
  for (const [id, list] of Object.entries(pending)) {
    const userTexts = new Set(
      (byId.get(id)?.transcript ?? [])
        .filter((m) => m.role === "user")
        .map((m) => m.text.trim())
    );
    const kept = list.filter(
      (p) => now - p.ts < PENDING_TTL_MS && !userTexts.has(p.text.trim())
    );
    if (kept.length) next[id] = kept;
  }
  return next;
}

export const useStore = create<State>((set, get) => ({
  sessions: [],
  queue: [],
  decisions: [],
  focusId: null,
  mode: "flow",
  detailId: null,
  pending: {},
  activeTab: {},
  loading: false,
  error: null,

  setActiveTab: (sessionId, tab) => {
    set((state) => ({ activeTab: { ...state.activeTab, [sessionId]: tab } }));
  },

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
        focusId: pickFocus(q, state.focusId),
        pending: prunePending(state.pending, s, Date.now()),
        error: null,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  recordSent: (sessionId, text) => {
    const t = text.trim();
    if (!t) return;
    set((state) => ({
      pending: {
        ...state.pending,
        [sessionId]: [...(state.pending[sessionId] ?? []), { text: t, ts: Date.now() }],
      },
    }));
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
      // A custom free-text reply travels back to the session like an instruction — show it optimistically.
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
    try { get().recordSent(sessionId, text); await window.cowork.instruct(sessionId, text); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
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
