import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { accelFromParts, actionForAccel, type ActionId } from "./keybindings";

const TAB_FOR: Partial<Record<ActionId, "chat" | "terminal" | "browser" | "ports" | "files">> = {
  "tab.chat": "chat",
  "tab.terminal": "terminal",
  "tab.browser": "browser",
  "tab.ports": "ports",
  "tab.files": "files",
};
// HUD uses its own window keys ("term" not "terminal"); the rest match.
const HUD_KEY: Record<string, string> = { chat: "chat", terminal: "term", browser: "browser", files: "files", ports: "ports" };

const HOLD_KEY: Record<string, string> = { Ctrl: "Control", Meta: "Meta", Alt: "Alt" };
/** The KeyboardEvent.key of the "hold" modifier in an accelerator (ignoring Shift,
 * which is the direction modifier), e.g. "Ctrl+Tab" → "Control". null if bare. */
function holdModifier(accel: string): string | null {
  for (const part of accel.split("+")) if (HOLD_KEY[part]) return HOLD_KEY[part];
  return null;
}

/**
 * Global keyboard-shortcut dispatcher. Cycling sessions opens an Alt-Tab-style
 * switcher that stays up while the modifier is held and commits on release; the
 * assistant toggle and the virtual-app tab shortcuts (Flow/Grid via activeTab, HUD
 * via the rcw-open-app bridge) fire immediately. Bindings are user-editable and
 * re-read live from the store.
 */
// The assistant-toggle / virtual-app-tab actions (everything except the hold-based
// session switcher). Shared by the DOM keydown path and the forwarded-guest-key path.
function runSimpleAction(action: ActionId): boolean {
  const st = useStore.getState();
  if (action === "assistant.toggle") { st.toggleAssist(); return true; }
  const tab = TAB_FOR[action];
  if (tab) {
    if (st.mode === "hud") st.requestHudApp(HUD_KEY[tab]);
    else if (st.focusId) st.setActiveTab(st.focusId, tab);
    return true;
  }
  return false;
}

export function useKeybindings(): void {
  const keybindings = useStore((s) => s.keybindings);
  // Which modifier is holding the switcher open (so we know when it's released).
  const holdKeyRef = useRef<string | null>(null);

  // Tell main which accelerators are bound so it can preventDefault them (and keep it
  // in sync when the user rebinds).
  useEffect(() => {
    window.cowork.syncKeybindings(Object.values(keybindings)).catch(() => {});
  }, [keybindings]);

  // The SOLE dispatcher: keys are captured in main (main window + every webview guest)
  // and forwarded here, so a shortcut fires no matter what has focus — a text field,
  // Monaco, the terminal, or a web page. keyDown drives actions + opens/moves the
  // session switcher; the hold-modifier keyUp commits it.
  useEffect(() => {
    const off = window.cowork.onGuestKey((k) => {
      const st = useStore.getState();
      if (k.type === "keyUp") {
        if (st.switcher && holdKeyRef.current && k.key === holdKeyRef.current) { st.commitSwitcher(); holdKeyRef.current = null; }
        return;
      }
      // keyDown
      if (st.switcher && k.key === "Escape") { st.cancelSwitcher(); holdKeyRef.current = null; return; }
      const accel = accelFromParts({ key: k.key, ctrl: k.ctrl, alt: k.alt, shift: k.shift, meta: k.meta });
      if (!accel) return;
      const action = actionForAccel(st.keybindings as Record<ActionId, string>, accel);
      if (!action) return;
      if (action === "session.next" || action === "session.prev") {
        const dir = action === "session.next" ? 1 : -1;
        const hold = holdModifier(st.keybindings[action] ?? "");
        if (!hold) { st.cycleFocus(dir); return; }
        if (st.switcher) st.moveSwitcher(dir);
        else { st.openSwitcher(dir); holdKeyRef.current = hold; }
        return;
      }
      runSimpleAction(action);
    });
    return off;
  }, []);

  // Losing OS focus mid-switch: commit to whatever's highlighted (don't wedge open).
  useEffect(() => {
    const onBlur = () => {
      const st = useStore.getState();
      if (st.switcher) { st.commitSwitcher(); holdKeyRef.current = null; }
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);
}
