import { useEffect } from "react";
import { useStore } from "../store";
import { accelFromEvent, actionForAccel, type ActionId } from "./keybindings";

const TAB_FOR: Partial<Record<ActionId, "chat" | "terminal" | "browser" | "ports" | "files">> = {
  "tab.chat": "chat",
  "tab.terminal": "terminal",
  "tab.browser": "browser",
  "tab.ports": "ports",
  "tab.files": "files",
};

/**
 * Global keyboard-shortcut dispatcher. Turns a keydown into a bound action —
 * cycling sessions (Ctrl+Tab), toggling the assistant, or focusing a virtual-app
 * tab of the focused session. Bindings are user-editable (store.keybindings) and
 * re-read live when the rebind panel changes them.
 */
export function useKeybindings(): void {
  const keybindings = useStore((s) => s.keybindings);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const accel = accelFromEvent(e);
      if (!accel) return;
      const action = actionForAccel(keybindings as Record<ActionId, string>, accel);
      if (!action) return;
      const st = useStore.getState();
      if (action === "session.next") { e.preventDefault(); st.cycleFocus(1); return; }
      if (action === "session.prev") { e.preventDefault(); st.cycleFocus(-1); return; }
      if (action === "assistant.toggle") { e.preventDefault(); st.toggleAssist(); return; }
      const tab = TAB_FOR[action];
      if (tab && st.focusId) { e.preventDefault(); st.setActiveTab(st.focusId, tab); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keybindings]);
}
