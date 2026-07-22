// UI sound effects. Three hi-tech cues (button click, new message, loading), played
// at the user's configured volume (Settings › Appearance, default 50%, 0 = muted).
// The wav assets are bundled by Vite (?url). Every call is best-effort and never
// throws — audio must never break the UI. Volume tracks the live appearance setting.

import buttonUrl from "./assets/sfx/button.wav?url";
import messageUrl from "./assets/sfx/message.wav?url";
import loadingUrl from "./assets/sfx/loading.wav?url";
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
    if (d && typeof d.sfxVolume === "number") volume = clamp01(d.sfxVolume / 100);
  });
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
