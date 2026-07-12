// Customizable in-app keyboard shortcuts. Actions map to accelerator strings like
// "Ctrl+Tab" / "Ctrl+1"; bindings are user-editable (rebind panel in Settings) and
// persisted in localStorage. The dispatch hook (useKeybindings) turns a keydown
// into an action; the settings panel edits the same bindings via the store.

export type ActionId =
  | "session.next"
  | "session.prev"
  | "assistant.toggle"
  | "tab.chat"
  | "tab.terminal"
  | "tab.browser"
  | "tab.ports"
  | "tab.files";

export type ActionDef = { id: ActionId; label: string; group: string; default: string };

// The shortcut catalog. Defaults use a modifier (Ctrl) so they never fire while the
// user is just typing. The virtual-app tabs map to Ctrl+1..5 in tab order.
export const ACTIONS: ActionDef[] = [
  { id: "session.next", label: "Next session", group: "Sessions", default: "Ctrl+Tab" },
  { id: "session.prev", label: "Previous session", group: "Sessions", default: "Ctrl+Shift+Tab" },
  { id: "assistant.toggle", label: "Toggle AI assistant", group: "Panels", default: "Ctrl+J" },
  { id: "tab.chat", label: "Open Chat", group: "Virtual apps", default: "Ctrl+1" },
  { id: "tab.terminal", label: "Open Terminal", group: "Virtual apps", default: "Ctrl+2" },
  { id: "tab.browser", label: "Open Browser", group: "Virtual apps", default: "Ctrl+3" },
  { id: "tab.ports", label: "Open Ports / Settings", group: "Virtual apps", default: "Ctrl+4" },
  { id: "tab.files", label: "Open Files", group: "Virtual apps", default: "Ctrl+5" },
];

const STORAGE_KEY = "rcw.keybindings.v1";
const MOD_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "CapsLock"]);

/** Canonical accelerator string for a keydown, or null for a bare modifier press. */
export function accelFromEvent(e: KeyboardEvent): string | null {
  if (MOD_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  // Named keys (Tab, Enter, ArrowUp, Escape, F1…) come through as-is.
  parts.push(key);
  return parts.join("+");
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const SYMBOL: Record<string, string> = IS_MAC
  ? { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" }
  : { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };

/** Pretty accelerator for display, e.g. "Ctrl+Shift+Tab" → "⌃⇧Tab" on macOS. */
export function displayAccel(accel: string): string {
  if (!accel) return "—";
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.map((m) => SYMBOL[m] ?? m).join(IS_MAC ? "" : "+");
  return IS_MAC ? `${mods}${key}` : [mods, key].filter(Boolean).join("+");
}

/** Load saved bindings merged over the defaults (so new actions get their default). */
export function bindingsWithDefaults(): Record<ActionId, string> {
  const defaults = Object.fromEntries(ACTIONS.map((a) => [a.id, a.default])) as Record<ActionId, string>;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<Record<ActionId, string>>;
    for (const a of ACTIONS) if (typeof saved[a.id] === "string") defaults[a.id] = saved[a.id]!;
  } catch {
    /* corrupt / unavailable — defaults */
  }
  return defaults;
}

export function saveBindings(b: Record<ActionId, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

export const DEFAULT_BINDINGS: Record<ActionId, string> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a.default]),
) as Record<ActionId, string>;

/** Which action (if any) a given accelerator is bound to. */
export function actionForAccel(bindings: Record<ActionId, string>, accel: string): ActionId | null {
  for (const a of ACTIONS) if (bindings[a.id] === accel) return a.id;
  return null;
}
