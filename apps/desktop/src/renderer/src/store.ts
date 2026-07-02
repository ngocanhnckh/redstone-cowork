import { create } from "zustand";
import { SessionView, Decision, Host, DiscoveredSession } from "./types";
import { pickFocus, nextWaiting } from "./autoAdvance";

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
  mode: "flow" | "grid" | "history" | "hud";
  detailId: string | null; // session shown in the grid's drill-in detail
  hosts: Host[]; // machines reporting via the redstone agent
  inventory: DiscoveredSession[]; // all discovered Claude Code sessions
  pending: Record<string, PendingSend[]>; // sessionId → optimistic sends, shown instantly
  activeTab: Record<string, "chat" | "terminal" | "browser" | "ports" | "files">; // sessionId → active workspace tab
  openBrowsers: string[]; // sessionIds whose browser tab was opened — kept alive (see BrowserStack)
  contextCollapsed: boolean; // right context sidebar collapsed (more room for the body)
  assistOpen: boolean; // LLM assistant slide-over
  settingsOpen: boolean; // connection settings modal
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setActiveTab: (sessionId: string, tab: "chat" | "terminal" | "browser" | "ports" | "files") => void;
  openBrowser: (sessionId: string) => void;
  toggleContext: () => void;
  toggleAssist: () => void;
  toggleSettings: () => void;
  setFocus: (id: string) => void;
  setMode: (mode: "flow" | "grid" | "history" | "hud") => void;
  fetchInventory: () => Promise<void>;
  inventoryAddTag: (id: string, tag: string) => Promise<void>;
  inventoryRemoveTag: (id: string, tag: string) => Promise<void>;
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
  interrupt: (sessionId: string, text?: string) => Promise<void>;
  switchMode: (sessionId: string, mode: string) => Promise<void>;
  addUserTodo: (sessionId: string, text: string) => Promise<void>;
  toggleUserTodo: (sessionId: string, todoId: string) => Promise<void>;
  deleteUserTodo: (sessionId: string, todoId: string) => Promise<void>;
  addTag: (sessionId: string, tag: string) => Promise<void>;
  removeTag: (sessionId: string, tag: string) => Promise<void>;
};

export const useStore = create<State>((set, get) => ({
  sessions: [],
  queue: [],
  decisions: [],
  focusId: null,
  mode: "flow",
  detailId: null,
  hosts: [],
  inventory: [],
  pending: {},
  activeTab: {},
  openBrowsers: [],
  contextCollapsed: false,
  assistOpen: false,
  settingsOpen: false,
  loading: false,
  error: null,

  setActiveTab: (sessionId, tab) => {
    set((state) => ({
      activeTab: { ...state.activeTab, [sessionId]: tab },
      // Once a session's browser is opened, keep it in the persistent stack forever.
      openBrowsers:
        tab === "browser" && !state.openBrowsers.includes(sessionId)
          ? [...state.openBrowsers, sessionId]
          : state.openBrowsers,
    }));
  },

  openBrowser: (sessionId) =>
    set((state) => (state.openBrowsers.includes(sessionId) ? {} : { openBrowsers: [...state.openBrowsers, sessionId] })),

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

  setMode: (mode: "flow" | "grid" | "history" | "hud") => {
    set({ mode, detailId: null });
    if (mode === "history") get().fetchInventory();
  },

  fetchInventory: async () => {
    try {
      const { hosts, sessions } = await window.cowork.getInventory();
      set({ hosts: hosts as Host[], inventory: sessions as DiscoveredSession[] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  inventoryAddTag: async (id, tag) => {
    if (!tag.trim()) return;
    try { await window.cowork.inventoryAddTag(id, tag.trim()); await get().fetchInventory(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  inventoryRemoveTag: async (id, tag) => {
    try { await window.cowork.inventoryRemoveTag(id, tag); await get().fetchInventory(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
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
      // Refresh first, then advance to the next session actually waiting for input
      // (fresh data + actionable-only, so we don't land on a thinking / passive one).
      await get().refresh();
      const { queue, decisions } = get();
      const next = sessionId ? nextWaiting(queue, decisions, sessionId) : null;
      if (next) set({ focusId: next });
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
      await window.cowork.instruct(sessionId, text);
      // Refresh FIRST so the advance decision uses fresh queue + decisions (a stale
      // snapshot was picking sessions that had since been answered / started thinking).
      await get().refresh();
      // In Flow mode, advance ONLY to a session genuinely waiting for the user's
      // answer (a pending question/permission), skipping the one we just messaged.
      // If nothing needs input, STAY — never jump to a thinking session or one that
      // only holds a passive completion card.
      if (get().mode === "flow") {
        const { queue, decisions } = get();
        const next = nextWaiting(queue, decisions, sessionId);
        if (next) set({ focusId: next });
      }
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  interrupt: async (sessionId, text) => {
    try {
      // Show the redirect instantly, like a normal send. A bare stop (no text)
      // just aborts. Stay on this session — the user is redirecting it, not moving on.
      if (text && text.trim()) get().recordSent(sessionId, text);
      await window.cowork.interrupt(sessionId, text?.trim() || undefined);
      await get().refresh();
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  switchMode: async (sessionId, mode) => {
    try { await window.cowork.switchMode(sessionId, mode); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  addUserTodo: async (sessionId, text) => {
    if (!text.trim()) return;
    try { await window.cowork.addUserTodo(sessionId, text.trim()); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  toggleUserTodo: async (sessionId, todoId) => {
    try { await window.cowork.toggleUserTodo(sessionId, todoId); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  deleteUserTodo: async (sessionId, todoId) => {
    try { await window.cowork.deleteUserTodo(sessionId, todoId); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  addTag: async (sessionId, tag) => {
    if (!tag.trim()) return;
    try { await window.cowork.addTag(sessionId, tag.trim()); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  removeTag: async (sessionId, tag) => {
    try { await window.cowork.removeTag(sessionId, tag); await get().refresh(); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },
}));

export function startCockpit(): () => void {
  useStore.getState().refresh();
  const unsub = window.cowork.onUpdate(() => useStore.getState().refresh());
  return unsub;
}
