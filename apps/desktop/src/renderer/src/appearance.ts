// Client-side appearance preferences: how transparent/blurred the app chrome is,
// whether the drifting background animation runs, and where the HUD dock sits.
// Persisted in localStorage and applied by mutating CSS variables / classes on the
// document root, so every surface (grid, HUD, login) reacts live. The custom
// background image itself lives in the main process (userData); only its presence
// is reflected here via a class.

import { useEffect, useState } from "react";

export type DockPos = "top" | "bottom" | "bottom-left" | "bottom-right" | "left" | "right";

export type Appearance = {
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
};

export const DEFAULT_APPEARANCE: Appearance = { veil: 6, blur: 28, bgAnim: true, dockPos: "bottom", dockScale: 1, hudClear: false };

const KEY = "rcw.appearance";

export function loadAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      veil: clampNum(raw.veil, 0, 40, DEFAULT_APPEARANCE.veil),
      blur: clampNum(raw.blur, 0, 80, DEFAULT_APPEARANCE.blur),
      bgAnim: typeof raw.bgAnim === "boolean" ? raw.bgAnim : DEFAULT_APPEARANCE.bgAnim,
      dockPos: DOCK_POSITIONS.includes(raw.dockPos) ? raw.dockPos : DEFAULT_APPEARANCE.dockPos,
      dockScale: clampNum(raw.dockScale, 0.6, 1.6, DEFAULT_APPEARANCE.dockScale),
      hudClear: typeof raw.hudClear === "boolean" ? raw.hudClear : DEFAULT_APPEARANCE.hudClear,
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
  r.classList.toggle("rcw-no-anim", !a.bgAnim);
  r.setAttribute("data-dock", a.dockPos);
  // Let live consumers (e.g. the HUD dock) react without prop-threading.
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
