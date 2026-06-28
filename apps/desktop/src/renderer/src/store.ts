import { create } from "zustand";
import { SessionView, Decision } from "./types";
import { pickFocus, nextAfterAnswer } from "./autoAdvance";

type State = {
  sessions: SessionView[];
  queue: SessionView[];
  decisions: Decision[];
  focusId: string | null;
  mode: "flow" | "grid";
  detailId: string | null; // session shown in the grid's drill-in detail
  activeTab: Record<string, "chat" | "terminal" | "browser" | "ports" | "files">; // sessionId → active workspace tab
  contextCollapsed: boolean; // right context sidebar collapsed (more room for the body)
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setActiveTab: (sessionId: string, tab: "chat" | "terminal" | "browser" | "ports" | "files") => void;
  toggleContext: () => void;
  setFocus: (id: string) => void;
  setMode: (mode: "flow" | "grid") => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
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
  activeTab: {},
  contextCollapsed: false,
  loading: false,
  error: null,

  setActiveTab: (sessionId, tab) => {
    set((state) => ({ activeTab: { ...state.activeTab, [sessionId]: tab } }));
  },

  toggleContext: () => set((state) => ({ contextCollapsed: !state.contextCollapsed })),

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
        error: null,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
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
    try { await window.cowork.instruct(sessionId, text); await get().refresh(); }
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
