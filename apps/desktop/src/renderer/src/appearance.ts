// Client-side appearance preferences: how transparent/blurred the app chrome is,
// whether the drifting background animation runs, and where the HUD dock sits.
// Persisted in localStorage and applied by mutating CSS variables / classes on the
// document root, so every surface (grid, HUD, login) reacts live. The custom
// background image itself lives in the main process (userData); only its presence
// is reflected here via a class.

import { useEffect, useState } from "react";

export type DockPos = "top" | "bottom" | "bottom-left" | "bottom-right" | "left" | "right";

export type Theme = "warm" | "hitech";

export type Appearance = {
  /** Visual theme. "warm" = the default clay/amber liquid-glass look; "hitech" =
   *  cyan holographic HUD (dark navy, cyan glow, grid texture, mono labels). Applied
   *  as a `data-theme` attribute on the document root that overrides the CSS tokens. */
  theme: Theme;
  /** UI sound-effect volume, 0–100 (0 = muted). Applied to every SFX via sfx.ts. */
  sfxVolume: number;
  /** Background ambient-loop volume, 0–100 (0 = off). Drives the looping hi-tech pad. */
  ambientVolume: number;
  /** App tint over the desktop/background, as a percentage (0 = clear). */
  veil: number;
  /** Backdrop blur of the app surface, in px. */
  blur: number;
  /** Drifting gradient "aurora" animation in the background. */
  bgAnim: boolean;
  /** Where the HUD dock is anchored. */
  dockPos: DockPos;
  /** HUD dock size multiplier (1 = default). */
  dockScale: number;
  /** In HUD mode, make the app shell fully transparent (see straight through to
   * the desktop; individual widgets keep their own glass). */
  hudClear: boolean;
  /** Panel/window glass solidity as a percentage (higher = more opaque/brighter
   * frosted glass, lower = more see-through). Drives --glass-pct. */
  glass: number;
  /** Mute the looping background video (if one is set). */
  videoMuted: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = { theme: "warm", sfxVolume: 50, ambientVolume: 30, veil: 6, blur: 28, bgAnim: true, dockPos: "bottom", dockScale: 1, hudClear: false, glass: 94, videoMuted: false };

const KEY = "rcw.appearance";

export function loadAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      theme: raw.theme === "hitech" ? "hitech" : DEFAULT_APPEARANCE.theme,
      sfxVolume: clampNum(raw.sfxVolume, 0, 100, DEFAULT_APPEARANCE.sfxVolume),
      ambientVolume: clampNum(raw.ambientVolume, 0, 100, DEFAULT_APPEARANCE.ambientVolume),
      veil: clampNum(raw.veil, 0, 40, DEFAULT_APPEARANCE.veil),
      blur: clampNum(raw.blur, 0, 80, DEFAULT_APPEARANCE.blur),
      bgAnim: typeof raw.bgAnim === "boolean" ? raw.bgAnim : DEFAULT_APPEARANCE.bgAnim,
      dockPos: DOCK_POSITIONS.includes(raw.dockPos) ? raw.dockPos : DEFAULT_APPEARANCE.dockPos,
      dockScale: clampNum(raw.dockScale, 0.6, 1.6, DEFAULT_APPEARANCE.dockScale),
      hudClear: typeof raw.hudClear === "boolean" ? raw.hudClear : DEFAULT_APPEARANCE.hudClear,
      glass: clampNum(raw.glass, 40, 100, DEFAULT_APPEARANCE.glass),
      videoMuted: typeof raw.videoMuted === "boolean" ? raw.videoMuted : DEFAULT_APPEARANCE.videoMuted,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: Appearance): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore quota */ }
}

/** Push the numeric/animation prefs into CSS vars + a class on the document root. */
export function applyAppearance(a: Appearance): void {
  const r = document.documentElement;
  r.style.setProperty("--app-veil", `${a.veil}%`);
  r.style.setProperty("--app-blur", `${a.blur}px`);
  r.style.setProperty("--glass-pct", `${a.glass}%`);
  r.classList.toggle("rcw-no-anim", !a.bgAnim);
  r.setAttribute("data-dock", a.dockPos);
  // The theme swaps the whole CSS-token set (see globals.css [data-theme="hitech"]).
  r.setAttribute("data-theme", a.theme);
  // Let live consumers (e.g. the HUD dock, sfx.ts volume) react without prop-threading.
  window.dispatchEvent(new CustomEvent("rcw-appearance", { detail: a }));
}

/** Live appearance — re-renders whenever prefs change (via applyAppearance). */
export function useAppearance(): Appearance {
  const [a, setA] = useState<Appearance>(loadAppearance);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as Appearance | undefined;
      setA(d ?? loadAppearance());
    };
    window.addEventListener("rcw-appearance", h);
    return () => window.removeEventListener("rcw-appearance", h);
  }, []);
  return a;
}

/** Set (or clear) the custom background image data URL on the document root. */
export function applyBgImage(dataUrl: string | null): void {
  const r = document.documentElement;
  if (dataUrl) {
    r.style.setProperty("--app-bg-image", `url("${dataUrl}")`);
    r.classList.add("rcw-has-bg");
  } else {
    r.style.removeProperty("--app-bg-image");
    r.classList.remove("rcw-has-bg");
  }
}

export const DOCK_POSITIONS: DockPos[] = ["top", "bottom", "bottom-left", "bottom-right", "left", "right"];

export const DOCK_LABEL: Record<DockPos, string> = {
  top: "Top",
  bottom: "Bottom (center)",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  left: "Left",
  right: "Right",
};

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
