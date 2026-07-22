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
    if (st.mode === "hud") {
      // HUD toggles the app window (revealApp: open/raise, or minimise if frontmost).
      st.requestHudApp(HUD_KEY[tab]);
    } else if (st.focusId) {
      // Flow/Grid toggle: pressing the shortcut for the ALREADY-active tab returns to
      // chat (hides it); otherwise switch to it. "chat" itself just stays on chat.
      const current = st.activeTab[st.focusId] ?? "chat";
      st.setActiveTab(st.focusId, current === tab && tab !== "chat" ? "chat" : tab);
    }
    return true;
  }
  return false;
}

/** Does a KeyboardEvent-style modifier flag set still hold `mod` ("Control"/…)? */
function modHeld(mod: string, m: { ctrl?: boolean; meta?: boolean; alt?: boolean }): boolean {
  return (mod === "Control" && !!m.ctrl) || (mod === "Meta" && !!m.meta) || (mod === "Alt" && !!m.alt);
}

export function useKeybindings(): void {
  const keybindings = useStore((s) => s.keybindings);
  // Which modifier is holding the switcher open (so we know when it's released).
  const holdKeyRef = useRef<string | null>(null);
  // Backstop timer: a modifier keyUp from inside a focused <webview> guest is
  // unreliable in Electron, so the hold-to-switch overlay could wedge open forever
  // (it's a full-screen zIndex-6000 layer — a wedged switcher looks like a freeze).
  // If no release arrives, auto-commit so it can never get stuck.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeSwitcher = (how: "commit" | "cancel"): void => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    holdKeyRef.current = null;
    const st = useStore.getState();
    if (!st.switcher) return;
    if (how === "cancel") { st.cancelSwitcher(); return; }
    st.commitSwitcher();
    // Landed on a session → put the cursor in its chat box so you can type right
    // away. Deferred so the newly-focused session's dock has rendered first.
    setTimeout(() => window.dispatchEvent(new CustomEvent("rcw-focus-chat")), 60);
  };
  const armHoldTimeout = (): void => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    // Short: the keyUp/focus paths commit instantly when they fire; this backstop
    // just makes sure a missed release settles fast (resets on every Tab move, so
    // tabbing through sessions keeps it open).
    holdTimer.current = setTimeout(() => { if (useStore.getState().switcher) closeSwitcher("commit"); }, 400);
  };

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
        if (st.switcher && holdKeyRef.current && k.key === holdKeyRef.current) closeSwitcher("commit");
        return;
      }
      // keyDown
      if (st.switcher && k.key === "Escape") { closeSwitcher("cancel"); return; }
      // If the switcher is open but its hold modifier is no longer down in THIS
      // event, the release was missed — commit now rather than wedge open.
      if (st.switcher && holdKeyRef.current && !modHeld(holdKeyRef.current, k)) { closeSwitcher("commit"); return; }
      const accel = accelFromParts({ key: k.key, ctrl: k.ctrl, alt: k.alt, shift: k.shift, meta: k.meta });
      if (!accel) return;
      const action = actionForAccel(st.keybindings as Record<ActionId, string>, accel);
      if (!action) return;
      if (action === "session.next" || action === "session.prev") {
        const dir = action === "session.next" ? 1 : -1;
        const hold = holdModifier(st.keybindings[action] ?? "");
        if (!hold) { st.cycleFocus(dir); return; }
        if (st.switcher) st.moveSwitcher(dir);
        else {
          st.openSwitcher(dir); holdKeyRef.current = hold;
          // Grab focus onto the host window so the modifier keyUp that commits the
          // switcher reaches us instantly — a focused webview/terminal guest
          // swallows keyUp, which is why it used to hang until the fallback timer.
          try { window.cowork.focusMainWindow(); } catch { /* ignore */ }
          try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* ignore */ }
        }
        armHoldTimeout(); // (re)start the no-release backstop on open AND each move
        return;
      }
      runSimpleAction(action);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback: a NATIVE keyup on the host window commits instantly when focus is on
  // the cockpit itself (the forwarded-guest path covers focus inside a webview).
  useEffect(() => {
    const onUp = (e: KeyboardEvent) => {
      if (holdKeyRef.current && e.key === holdKeyRef.current) closeSwitcher("commit");
    };
    window.addEventListener("keyup", onUp, true);
    return () => { window.removeEventListener("keyup", onUp, true); if (holdTimer.current) clearTimeout(holdTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Losing OS focus mid-switch: commit to whatever's highlighted (don't wedge open).
  useEffect(() => {
    const onBlur = () => { if (useStore.getState().switcher) closeSwitcher("commit"); };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
