import { create } from "zustand";
import { SessionView, Decision, Host, DiscoveredSession, CapsHostView } from "./types";
import { pickFocus, nextWaiting } from "./autoAdvance";

/**
 * A reply shown instantly in the timeline before the host echoes it back. We
 * snapshot the session's USER-message count at send time (`baseUsers`); once the
 * transcript has one more user turn than that, the host has recorded this message
 * and the optimistic copy is dropped. Counting user turns (not total length) is
 * key: Claude's assistant output streams in continuously, so a length snapshot
 * would prune the bubble the instant Claude speaks — before the user's message
 * lands — making it vanish. Robust to the host rewriting the text (chunk/trim).
 */
export type PendingSend = { text: string; baseUsers: number; ts: number };

/** Safety net: drop an un-incorporated optimistic send after this long (ms). A
 * message can sit queued in Claude's input while a long turn finishes (multi-minute
 * "cogitating"), so keep the bubble visible generously rather than dropping it. */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Number of USER messages in a session's transcript, across sessions and queue.
 * We count user turns (not total length) because Claude's own assistant output
 * streams into the transcript continuously — using total length would prune an
 * optimistic send the moment Claude speaks, before the user's message ever lands. */
function userMsgCount(sessions: SessionView[], queue: SessionView[], id: string): number {
  const s = sessions.find((x) => x.id === id) ?? queue.find((x) => x.id === id);
  return (s?.transcript ?? []).reduce((n, m) => n + (m.role === "user" ? 1 : 0), 0);
}

/** Drop optimistic sends once the host has recorded them as a user turn (the user
 * message count grew past the snapshot) or they aged out. Assistant-only transcript
 * growth never prunes them — otherwise a still-queued message vanishes mid-turn. */
function prunePending(
  pending: Record<string, PendingSend[]>,
  sessions: SessionView[],
  queue: SessionView[],
  now: number
): Record<string, PendingSend[]> {
  const next: Record<string, PendingSend[]> = {};
  for (const [id, list] of Object.entries(pending)) {
    const users = userMsgCount(sessions, queue, id);
    const kept = list.filter((p) => now - p.ts < PENDING_TTL_MS && users <= p.baseUsers);
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
  caps: CapsHostView[]; // installed skills + slash commands per host
  capsOpen: boolean; // the skills/commands browser modal
  pending: Record<string, PendingSend[]>; // sessionId → optimistic sends, shown instantly
  activeTab: Record<string, "chat" | "terminal" | "browser" | "ports" | "files">; // sessionId → active workspace tab
  openBrowsers: string[]; // sessionIds whose browser tab was opened — kept alive (see BrowserStack)
  // A one-shot request to open a URL in a session's in-app browser (a new tab). The
  // session's MultiBrowser opens+activates a tab; the HUD reveals the browser window.
  pendingBrowserOpen: { sessionId: string; url: string; nonce: number } | null;
  // A one-shot request to pop a session's chat into its own floating HUD window
  // (for side-by-side work on multiple sessions in the same folder). The HUD reacts
  // by creating/revealing a `sess:<id>` window; switches to HUD mode if needed.
  pendingSessionWindow: { sessionId: string; nonce: number } | null;
  openTerminals: string[]; // sessionIds whose terminal was opened — kept alive (see TerminalStack)
  contextCollapsed: boolean; // right context sidebar collapsed (more room for the body)
  assistOpen: boolean; // LLM assistant slide-over
  settingsOpen: boolean; // connection settings modal
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setActiveTab: (sessionId: string, tab: "chat" | "terminal" | "browser" | "ports" | "files") => void;
  openBrowser: (sessionId: string) => void;
  openUrlInBrowser: (sessionId: string, url: string) => void;
  openSessionWindow: (sessionId: string) => void;
  openTerminal: (sessionId: string) => void;
  toggleContext: () => void;
  toggleAssist: () => void;
  toggleSettings: () => void;
  setFocus: (id: string) => void;
  setMode: (mode: "flow" | "grid" | "history" | "hud") => void;
  fetchInventory: () => Promise<void>;
  fetchCaps: () => Promise<void>;
  toggleCaps: () => void;
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
  dismissSession: (sessionId: string) => Promise<void>;
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
  caps: [],
  capsOpen: false,
  pending: {},
  activeTab: {},
  openBrowsers: [],
  pendingBrowserOpen: null,
  pendingSessionWindow: null,
  openTerminals: [],
  contextCollapsed: false,
  assistOpen: false,
  settingsOpen: false,
  loading: false,
  error: null,

  setActiveTab: (sessionId, tab) => {
    set((state) => ({
      activeTab: { ...state.activeTab, [sessionId]: tab },
      // Once a session's browser/terminal is opened, keep it in the persistent
      // stack forever so switching sessions never reloads/recreates it.
      openBrowsers:
        tab === "browser" && !state.openBrowsers.includes(sessionId)
          ? [...state.openBrowsers, sessionId]
          : state.openBrowsers,
      openTerminals:
        tab === "terminal" && !state.openTerminals.includes(sessionId)
          ? [...state.openTerminals, sessionId]
          : state.openTerminals,
    }));
  },

  openBrowser: (sessionId) =>
    set((state) => (state.openBrowsers.includes(sessionId) ? {} : { openBrowsers: [...state.openBrowsers, sessionId] })),

  // Open a URL in the session's own in-app browser (our workspace browser, never
  // the OS browser): ensure the browser layer is alive for the session, then bump a
  // one-shot request the MultiBrowser + HUD react to (new tab + reveal the window).
  openUrlInBrowser: (sessionId, url) =>
    set((state) => ({
      openBrowsers: state.openBrowsers.includes(sessionId) ? state.openBrowsers : [...state.openBrowsers, sessionId],
      pendingBrowserOpen: { sessionId, url, nonce: (state.pendingBrowserOpen?.nonce ?? 0) + 1 },
    })),

  // Pop a session's chat into a floating HUD window. Switch to HUD mode (windows
  // live there) and bump a one-shot request the HUD reacts to.
  openSessionWindow: (sessionId) =>
    set((state) => ({
      mode: "hud",
      pendingSessionWindow: { sessionId, nonce: (state.pendingSessionWindow?.nonce ?? 0) + 1 },
    })),

  openTerminal: (sessionId) =>
    set((state) => (state.openTerminals.includes(sessionId) ? {} : { openTerminals: [...state.openTerminals, sessionId] })),

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
      // Snapshot the user-message count + already-queued sends, so multiple quick
      // sends each clear in order as the host records them one at a time.
      const baseUsers = userMsgCount(state.sessions, state.queue, sessionId) + existing.length;
      return {
        pending: {
          ...state.pending,
          [sessionId]: [...existing, { text: t, baseUsers, ts: Date.now() }],
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

  fetchCaps: async () => {
    try {
      const caps = await window.cowork.getCaps();
      set({ caps: caps as CapsHostView[] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  toggleCaps: () => {
    const opening = !get().capsOpen;
    set({ capsOpen: opening });
    if (opening) get().fetchCaps();
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
      // Refresh first, then (in Flow mode only) advance to the next session actually
      // waiting for input. Other modes — HUD / grid / history — stay put so the user
      // isn't yanked to another session after answering.
      await get().refresh();
      if (get().mode === "flow") {
        const { queue, decisions } = get();
        const next = sessionId ? nextWaiting(queue, decisions, sessionId) : null;
        if (next) set({ focusId: next });
      }
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

  dismissSession: async (sessionId: string) => {
    try {
      await window.cowork.dismissSession(sessionId);
      // Optimistically drop it from local state so the card vanishes immediately.
      set((state) => {
        const sessions = state.sessions.filter((s) => s.id !== sessionId);
        const queue = state.queue.filter((q) => q.id !== sessionId);
        // If we just dismissed the focused session, move focus to the next one
        // genuinely waiting for input, else the first remaining session (or none).
        let focusId = state.focusId;
        if (focusId === sessionId) {
          focusId = nextWaiting(queue, state.decisions, sessionId) ?? queue[0]?.id ?? sessions[0]?.id ?? null;
        }
        return { sessions, queue, focusId };
      });
      // Refetch to stay in sync with the server's soft-close.
      await get().refresh();
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
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
  // Load installed skills/commands for slash-autocomplete; refresh occasionally.
  useStore.getState().fetchCaps();
  const capsTimer = setInterval(() => useStore.getState().fetchCaps(), 5 * 60_000);
  const unsub = window.cowork.onUpdate(() => useStore.getState().refresh());
  return () => { clearInterval(capsTimer); unsub(); };
}
