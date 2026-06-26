import { create } from "zustand";
import { SessionView, Decision } from "./types";
import { pickFocus, nextAfterAnswer } from "./autoAdvance";

type State = {
  sessions: SessionView[];
  queue: SessionView[];
  decisions: Decision[];
  focusId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setFocus: (id: string) => void;
  answer: (
    decisionId: string,
    resolution: { choice?: string | null; answers?: null; custom?: string | null }
  ) => Promise<void>;
  snooze: (sessionId: string, minutes: number) => Promise<void>;
  pin: (sessionId: string, pinned: boolean) => Promise<void>;
};

export const useStore = create<State>((set, get) => ({
  sessions: [],
  queue: [],
  decisions: [],
  focusId: null,
  loading: false,
  error: null,

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
}));

export function startCockpit(): () => void {
  useStore.getState().refresh();
  const unsub = window.cowork.onUpdate(() => useStore.getState().refresh());
  return unsub;
}
