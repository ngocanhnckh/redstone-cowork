// UI sound effects. Three hi-tech cues (button click, new message, loading), played
// at the user's configured volume (Settings › Appearance, default 50%, 0 = muted).
// The wav assets are bundled by Vite (?url). Every call is best-effort and never
// throws — audio must never break the UI. Volume tracks the live appearance setting.

import buttonUrl from "./assets/sfx/button.wav?url";
import messageUrl from "./assets/sfx/message.wav?url";
import loadingUrl from "./assets/sfx/loading.wav?url";
import thinkingUrl from "./assets/sfx/thinking.mp3?url";
import { loadAppearance } from "./appearance";

export type SfxName = "button" | "message" | "loading";

const SRC: Record<SfxName, string> = { button: buttonUrl, message: messageUrl, loading: loadingUrl };

// One decoded element per sound, cloned per play so overlapping triggers (e.g. rapid
// clicks) don't cut each other off.
const base: Partial<Record<SfxName, HTMLAudioElement>> = {};
function baseFor(name: SfxName): HTMLAudioElement {
  let el = base[name];
  if (!el) {
    el = new Audio(SRC[name]);
    el.preload = "auto";
    base[name] = el;
  }
  return el;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

// Current volume (0..1), initialised from storage and kept in sync with Settings.
let volume = clamp01(loadAppearance().sfxVolume / 100);
if (typeof window !== "undefined") {
  window.addEventListener("rcw-appearance", (e) => {
    const d = (e as CustomEvent).detail as { sfxVolume?: number } | undefined;
    if (d && typeof d.sfxVolume === "number") {
      volume = clamp01(d.sfxVolume / 100);
      // Reflect the new level onto (or silence) a running thinking loop live.
      if (thinkingEl) {
        thinkingEl.volume = volume;
        if (volume <= 0) thinkingEl.pause();
        else if (thinkingWanted && thinkingEl.paused) thinkingEl.play().catch(() => {});
      }
    }
  });
}

// The "Claude is thinking" ambience loop — a single looping element toggled on/off
// while the focused session works (see setThinking). Kept separate from the one-shot
// cue pool. `thinkingWanted` remembers intent so a volume change can resume it.
let thinkingEl: HTMLAudioElement | null = null;
let thinkingWanted = false;

/** Start/stop the looping "thinking" ambience. On while the focused session works. */
export function setThinking(on: boolean): void {
  thinkingWanted = on;
  if (on) {
    if (volume <= 0) return; // muted → don't start; a later volume bump resumes it
    if (!thinkingEl) {
      thinkingEl = new Audio(thinkingUrl);
      thinkingEl.loop = true;
    }
    thinkingEl.volume = volume;
    if (thinkingEl.paused) thinkingEl.play().catch(() => {});
  } else if (thinkingEl && !thinkingEl.paused) {
    thinkingEl.pause();
  }
}

// Rate-limit each sound so a burst (e.g. many sessions completing at once, or a
// flurry of clicks) can't stack into noise. Per-name last-played timestamp.
const lastAt: Partial<Record<SfxName, number>> = {};
const MIN_GAP_MS: Record<SfxName, number> = { button: 40, message: 400, loading: 600 };

function playAt(name: SfxName, vol: number): void {
  if (vol <= 0) return;
  try {
    const el = baseFor(name).cloneNode(true) as HTMLAudioElement;
    el.volume = vol;
    void el.play().catch(() => {});
  } catch {
    /* audio unavailable — ignore */
  }
}

/** Play a UI sound at the user's configured volume. No-op when muted. Never throws. */
export function playSfx(name: SfxName): void {
  if (volume <= 0) return;
  const now = Date.now();
  if (now - (lastAt[name] ?? 0) < MIN_GAP_MS[name]) return;
  lastAt[name] = now;
  playAt(name, volume);
}

/** Preview a sound at a SPECIFIC volume (the Settings slider), bypassing the rate
 *  limit and the saved level so the user hears exactly what they're setting. */
export function previewSfx(name: SfxName, vol01: number): void {
  playAt(name, clamp01(vol01));
}

// Install the global UI cues on THIS window. Called once per window (from main.tsx)
// so both the cockpit AND pop-out terminal windows get them. Idempotent-guarded.
// The click sound fires on real buttons; the key sound fires ONLY on Enter (i.e.
// sending a message / submitting) — NOT on every keystroke.
let installed = false;
export function installGlobalSfx(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    // Fire on any INTERACTIVE target — not just <button>. Lots of the UI (HUD tabs,
    // session rows, dock items) are div/span with onClick + cursor:pointer, so we
    // also treat a pointer cursor as "clickable" (cursor inherits, so an inner span
    // reads its parent's pointer). Covers buttons, links, tabs and custom controls.
    const tag = el.closest("button, a, [role=button], [role=tab], [role=menuitem], summary, select, label");
    let clickable = !!tag;
    if (!clickable) {
      try { clickable = getComputedStyle(el).cursor === "pointer"; } catch { /* detached node */ }
    }
    if (clickable) playSfx("button");
  }, { capture: true });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.repeat) playSfx("button");
  }, { capture: true });
}
