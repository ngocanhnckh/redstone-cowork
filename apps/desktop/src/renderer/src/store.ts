import { create } from "zustand";
import { SessionView, Decision, Host, DiscoveredSession, CapsHostView } from "./types";
import { pickFocus, nextWaiting } from "./autoAdvance";
import { bindingsWithDefaults, saveBindings, DEFAULT_BINDINGS } from "./cockpit/keybindings";

/**
 * A reply shown instantly in the timeline before the host echoes it back. We
 * snapshot the session's USER-message count at send time (`baseUsers`); once the
 * transcript has one more user turn than that, the host has recorded this message
 * and the optimistic copy is dropped. Counting user turns (not total length) is
 * key: Claude's assistant output streams in continuously, so a length snapshot
 * would prune the bubble the instant Claude speaks — before the user's message
 * lands — making it vanish. Robust to the host rewriting the text (chunk/trim).
 */
export type PendingSend = { text: string; baseUsers: number; ts: number; answerAtSend: string | null };

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

/**
 * Retire the oldest optimistic send for any session whose server `working` flag
 * just flipped true→false — a definitive "the turn ended" signal from the host's
 * Stop hook. This is the safety net for when the count-based prune can't fire: a
 * big turn's output can push the user's own prompt out of the transcript tail
 * (byte/line-bounded), so the user-message count never grows past `baseUsers` and
 * the send (plus its "working" loader) would otherwise wedge until the TTL. One
 * transition retires exactly one send (oldest first), mirroring the in-order
 * count-based prune, so a message still queued behind an earlier one isn't dropped
 * prematurely. `nowWorking`/`prevWorking` map sessionId → last-seen working flag.
 */
export function consumeFinishedPending(
  pending: Record<string, PendingSend[]>,
  prevWorking: Record<string, boolean>,
  nowWorking: Record<string, boolean>
): Record<string, PendingSend[]> {
  const next: Record<string, PendingSend[]> = { ...pending };
  for (const id of Object.keys(next)) {
    if (prevWorking[id] === true && nowWorking[id] === false && next[id]?.length) {
      const [, ...rest] = next[id];
      if (rest.length) next[id] = rest;
      else delete next[id];
    }
  }
  return next;
}

/**
 * Retire the oldest optimistic send for a session that is IDLE (`working:false`) and
 * whose assistant prose (`latestAnswer`) has advanced since the send. That's a
 * definitive "your message was processed and Claude is done" signal that needs
 * neither the working true→false EDGE (which a poll can miss entirely on a fast turn)
 * NOR the transcript user-count (which can't grow when a huge turn pushes the prompt
 * out of the transcript tail). Without this, the "working…" loader on a giant session
 * could sit for up to the 10-min TTL after the reply already arrived. One retirement
 * per pass (oldest first), matching consumeFinishedPending, so a genuinely-queued
 * later message isn't dropped early.
 */
export function consumeAnsweredPending(
  pending: Record<string, PendingSend[]>,
  sessions: SessionView[],
  queue: SessionView[]
): Record<string, PendingSend[]> {
  const next: Record<string, PendingSend[]> = { ...pending };
  for (const id of Object.keys(next)) {
    const s = sessions.find((x) => x.id === id) ?? queue.find((x) => x.id === id);
    if (!s || s.working) continue; // still working → keep the loader
    const list = next[id];
    if (!list?.length) continue;
    // latestAnswer changed since the send → Claude spoke after we queued it, and it's
    // now idle, so the message has been handled.
    if (s.latestAnswer != null && s.latestAnswer !== list[0].answerAtSend) {
      const [, ...rest] = list;
      if (rest.length) next[id] = rest;
      else delete next[id];
    }
  }
  return next;
}

/**
 * Sends that were accepted by the API but look like they were never DELIVERED to the
 * host (typed into the session) — the oldest pending send for a session that has sat
 * un-incorporated for STALE_SEND_MS while the session is IDLE and not blocked on a
 * question. That combination means the host should have picked it up but didn't (dead
 * poller/hooks, or a mid-turn race dropped the keystrokes). Returns sessionId → the
 * undelivered text so the UI can offer a one-click resend instead of losing it.
 */
const STALE_SEND_MS = 30_000;
export function computeUndelivered(
  pending: Record<string, PendingSend[]>,
  sessions: SessionView[],
  queue: SessionView[],
  decisions: Decision[],
  now: number
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, list] of Object.entries(pending)) {
    const oldest = list[0];
    if (!oldest || now - oldest.ts < STALE_SEND_MS) continue; // give it time to land
    const s = sessions.find((x) => x.id === id) ?? queue.find((x) => x.id === id);
    if (!s || s.working) continue; // still working → it may be processing the queue
    // Blocked on a question/permission → input is captured by that prompt, not dropped.
    if (decisions.some((d) => d.sessionId === id && (d.kind === "question" || d.kind === "permission"))) continue;
    // Already incorporated (host typed it, transcript grew) → not undelivered.
    if (userMsgCount(sessions, queue, id) > oldest.baseUsers) continue;
    out[id] = oldest.text;
  }
  return out;
}

/** Last-seen server `working` flag per session — module-level bookkeeping so
 * refresh() can detect the true→false edge (a turn ending) between polls. */
let lastWorking: Record<string, boolean> = {};

/**
 * Backstop for a stuck server `working` flag. The host clears `working` on Claude's
 * Stop/idle hooks — but if those hooks stop firing (e.g. Claude was restarted in the
 * tmux without the wrapper, or the session's hooks broke) while the poller keeps the
 * session alive, `working` can sit true forever and the cockpit spins its loader with
 * no end. Real work continuously grows the transcript (each tool result is pushed), so
 * we treat `working` as stale once it's been true with NO new output for this long.
 */
const STUCK_WORKING_MS = 3 * 60 * 1000;
let workingSinceById: Record<string, number> = {}; // sessionId → when the current working spell (or its last output) was seen
let lastTranscriptLen: Record<string, number> = {}; // sessionId → transcript length at that time

/**
 * Sessions whose `working` flag is stale (true, but no new transcript output for
 * STUCK_WORKING_MS). Recomputed each poll; the timer resets whenever the transcript
 * grows, so a genuinely-working session (which keeps emitting output) is never marked
 * stale. Returns a set of sessionIds the UI should treat as NOT working.
 */
export function computeStaleWorking(lists: SessionView[][], now: number): Record<string, boolean> {
  const stale: Record<string, boolean> = {};
  const seen = new Set<string>();
  for (const list of lists) {
    for (const s of list) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const tl = s.transcript?.length ?? 0;
      if (s.working) {
        // (Re)start the timer when we first see it working or when new output arrives.
        if (workingSinceById[s.id] == null || lastTranscriptLen[s.id] !== tl) workingSinceById[s.id] = now;
        lastTranscriptLen[s.id] = tl;
        if (now - workingSinceById[s.id] > STUCK_WORKING_MS) stale[s.id] = true;
      } else {
        delete workingSinceById[s.id];
        lastTranscriptLen[s.id] = tl;
      }
    }
  }
  return stale;
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
  undeliveredSends: Record<string, string>; // sessionId → text of a send that looks undelivered (offer resend)
  retrySend: (sessionId: string, text: string) => Promise<void>;
  workingStale: Record<string, boolean>; // sessionId → server `working` is stuck (no output for a while); UI treats as idle
  activeTab: Record<string, "chat" | "terminal" | "browser" | "ports" | "files">; // sessionId → active workspace tab
  openBrowsers: string[]; // sessionIds whose browser tab was opened — kept alive (see BrowserStack)
  // A one-shot request to open a URL in a session's in-app browser (a new tab). The
  // session's MultiBrowser opens+activates a tab; the HUD reveals the browser window.
  pendingBrowserOpen: { sessionId: string; url: string; nonce: number } | null;
  // A one-shot request to reveal a HUD virtual-app window (chat/term/browser/…) —
  // fired by the keyboard shortcuts (Ctrl+1..5). Nonce so each press fires once.
  hudAppRequest: { key: string; nonce: number } | null;
  requestHudApp: (key: string) => void;
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
  /** True once the FIRST session fetch has succeeded. Distinguishes "connected but
   * genuinely nothing waiting" (show All-clear) from "never connected / failed"
   * (show the boot screen + the real error, not a misleading All-clear). */
  hasLoaded: boolean;
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
  /** Move focus to the next (+1) / previous (-1) session — drives the Ctrl+Tab
   * session switcher (HUD + everywhere). Cycles the full connected-session list. */
  cycleFocus: (dir: 1 | -1) => void;
  /** Alt-Tab-style session switcher overlay: `ids` is the snapshotted session order
   * at open time (stable while you hold the modifier), `index` is the highlighted one.
   * null when the overlay is closed. */
  switcher: { ids: string[]; index: number } | null;
  openSwitcher: (dir: 1 | -1) => void;
  moveSwitcher: (dir: 1 | -1) => void;
  commitSwitcher: () => void;
  cancelSwitcher: () => void;
  setMode: (mode: "flow" | "grid" | "history" | "hud") => void;
  /** User-customizable keyboard shortcuts (action id → accelerator). */
  keybindings: Record<string, string>;
  setKeybinding: (id: string, accel: string) => void;
  resetKeybindings: () => void;
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
    resolution: { choice?: string | null; answers?: Record<string, string | string[]> | null; custom?: string | null }
  ) => Promise<boolean>;
  snooze: (sessionId: string, minutes: number) => Promise<void>;
  pin: (sessionId: string, pinned: boolean) => Promise<void>;
  dismissSession: (sessionId: string) => Promise<void>;
  instruct: (sessionId: string, text: string) => Promise<boolean>;
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
  undeliveredSends: {},
  workingStale: {},
  activeTab: {},
  openBrowsers: [],
  pendingBrowserOpen: null,
  hudAppRequest: null,
  requestHudApp: (key) => set((state) => ({ hudAppRequest: { key, nonce: (state.hudAppRequest?.nonce ?? 0) + 1 } })),
  pendingSessionWindow: null,
  openTerminals: [],
  contextCollapsed: false,
  assistOpen: false,
  settingsOpen: false,
  loading: false,
  error: null,
  hasLoaded: false,

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
      // Snapshot each session's current `working` flag, then retire an optimistic
      // send for any that just finished a turn (true→false) before the count-based
      // prune runs — covers the case where a big turn scrolled the user's prompt
      // out of the transcript tail so the count can never catch up.
      const nowWorking: Record<string, boolean> = {};
      for (const sv of [...q, ...s]) nowWorking[sv.id] = !!sv.working;
      const workingStale = computeStaleWorking([s, q], Date.now());
      set((state) => {
        const now = Date.now();
        const newPending = prunePending(consumeAnsweredPending(consumeFinishedPending(state.pending, lastWorking, nowWorking), s, q), s, q, now);
        return {
          queue: q,
          sessions: s,
          decisions: d,
          focusId: pickFocus(q, s, state.focusId),
          pending: newPending,
          undeliveredSends: computeUndelivered(newPending, s, q, d, now),
          workingStale,
          error: null,
          hasLoaded: true,
        };
      });
      lastWorking = nowWorking;
    } catch (e) {
      // Keep any previously-loaded sessions on a transient blip, but record the
      // error so the UI can surface WHY (and the boot screen, if we never loaded).
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
      // Snapshot the current assistant prose so we can detect when Claude has
      // replied since this send (a fast-retire signal for giant sessions).
      const sess = state.sessions.find((x) => x.id === sessionId) ?? state.queue.find((x) => x.id === sessionId);
      const answerAtSend = sess?.latestAnswer ?? null;
      return {
        pending: {
          ...state.pending,
          [sessionId]: [...existing, { text: t, baseUsers, ts: Date.now(), answerAtSend }],
        },
      };
    });
  },

  setFocus: (id: string) => {
    set({ focusId: id });
  },

  cycleFocus: (dir) => {
    const { sessions, queue, focusId } = get();
    // Cycle the full connected-session list (fall back to the waiting queue).
    const list = sessions.length ? sessions : queue;
    if (list.length === 0) return;
    const idx = list.findIndex((s) => s.id === focusId);
    const next = list[(((idx < 0 ? 0 : idx) + dir) % list.length + list.length) % list.length];
    if (next) set({ focusId: next.id });
  },

  switcher: null,
  openSwitcher: (dir) => {
    const { sessions, queue, focusId } = get();
    const list = sessions.length ? sessions : queue;
    if (list.length === 0) return;
    const ids = list.map((s) => s.id);
    const cur = ids.indexOf(focusId ?? "");
    const index = (((cur < 0 ? 0 : cur) + dir) % ids.length + ids.length) % ids.length;
    set({ switcher: { ids, index } });
  },
  moveSwitcher: (dir) =>
    set((s) => (s.switcher ? { switcher: { ...s.switcher, index: ((s.switcher.index + dir) % s.switcher.ids.length + s.switcher.ids.length) % s.switcher.ids.length } } : {})),
  commitSwitcher: () => {
    const sw = get().switcher;
    if (sw) {
      const id = sw.ids[sw.index];
      if (id) set({ focusId: id });
    }
    set({ switcher: null });
  },
  cancelSwitcher: () => set({ switcher: null }),

  keybindings: bindingsWithDefaults(),
  setKeybinding: (id, accel) =>
    set((s) => {
      const keybindings = { ...s.keybindings, [id]: accel };
      saveBindings(keybindings as Record<import("./cockpit/keybindings").ActionId, string>);
      return { keybindings };
    }),
  resetKeybindings: () => {
    saveBindings(DEFAULT_BINDINGS);
    set({ keybindings: { ...DEFAULT_BINDINGS } });
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
    resolution: { choice?: string | null; answers?: Record<string, string | string[]> | null; custom?: string | null }
  ): Promise<boolean> => {
    const sessionId = get().decisions.find((d) => d.id === decisionId)?.sessionId ?? null;
    try {
      // A custom free-text reply travels back like an instruction — show it instantly.
      if (sessionId && resolution.custom) get().recordSent(sessionId, resolution.custom);
      await window.cowork.resolveDecision(decisionId, {
        choice: null,
        answers: null,
        custom: null,
        ...resolution,
      });
      // Optimistically drop the resolved decision so its card clears INSTANTLY —
      // even if the follow-up refresh is slow. A dock that sat showing the options
      // "forever" after a click (slow/failed refresh) was a real complaint.
      set((state) => ({ decisions: state.decisions.filter((d) => d.id !== decisionId) }));
      // Refresh first, then (in Flow mode only) advance to the next session actually
      // waiting for input. Other modes — HUD / grid / history — stay put so the user
      // isn't yanked to another session after answering.
      await get().refresh();
      if (get().mode === "flow") {
        const { queue, decisions } = get();
        const next = sessionId ? nextWaiting(queue, decisions, sessionId) : null;
        if (next) set({ focusId: next });
      }
      return true;
    } catch (e) {
      // The resolve never landed — surface it so the click isn't silently lost, and
      // leave the card in place so the user can retry (the caller re-enables its UI).
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
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
      return true;
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); return false; }
  },

  // Re-deliver a send that looks undelivered. The optimistic bubble already exists, so
  // this doesn't record a new one — it just re-posts the instruction and resets the
  // send's timer so it isn't immediately re-flagged.
  retrySend: async (sessionId, text) => {
    try {
      await window.cowork.instruct(sessionId, text);
      set((state) => {
        const list = state.pending[sessionId];
        const bumped = list?.length
          ? { ...state.pending, [sessionId]: list.map((p, i) => (i === 0 ? { ...p, ts: Date.now() } : p)) }
          : state.pending;
        const { [sessionId]: _drop, ...rest } = state.undeliveredSends;
        return { pending: bumped, undeliveredSends: rest };
      });
      await get().refresh();
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  },

  interrupt: async (sessionId, text) => {
    try {
      // Show the redirect instantly, like a normal send. A bare stop (no text)
      // just aborts. Stay on this session — the user is redirecting it, not moving on.
      if (text && text.trim()) get().recordSent(sessionId, text);
      // Optimistically clear `working` so the "processing" animation stops the moment
      // you hit Stop — an Escape doesn't fire a Stop hook, so we'd otherwise wait on
      // the server. The server also clears it on interrupt, so the refresh agrees.
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, working: false } : s)),
        queue: state.queue.map((s) => (s.id === sessionId ? { ...s, working: false } : s)),
      }));
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
  useStore.getState().fetchCaps();
  const capsTimer = setInterval(() => useStore.getState().fetchCaps(), 5 * 60_000);
  const unsub = window.cowork.onUpdate(() => useStore.getState().refresh());
  return () => { clearInterval(capsTimer); unsub(); };
}
