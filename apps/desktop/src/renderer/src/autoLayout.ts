import { useEffect, useState } from "react";

/**
 * Auto-layout: switch each session's HUD window arrangement to a saved template
 * automatically based on the current screen size — so a layout you built on a big
 * desktop monitor doesn't have to be redone by hand when you move to a laptop.
 *
 * Two "screen classes" (laptop / desktop) are decided from `window.screen.width`
 * against a configurable breakpoint. A template can be assigned to each class per
 * session, with a global default used for any session that has no assignment. The
 * arrangement is (re)applied on fullscreen, at launch, and whenever the class
 * changes (e.g. plugging/unplugging a monitor). See Hud.tsx for the apply logic.
 */

export type ScreenClass = "laptop" | "desktop";

/** A template name for each screen class (null = none assigned). */
export type ClassMap = { laptop: string | null; desktop: string | null };

export type AutoLayout = {
  enabled: boolean;
  /** Screen width (px) at or below which the screen is treated as a laptop. */
  breakpoint: number;
  /** Fallback templates for sessions without their own assignment. */
  global: ClassMap;
  /** Per-session template assignments, keyed by session id. */
  perSession: Record<string, ClassMap>;
};

export const DEFAULT_AUTOLAYOUT: AutoLayout = {
  enabled: false,
  breakpoint: 1800,
  global: { laptop: null, desktop: null },
  perSession: {},
};

const KEY = "rcw.hud.autolayout.v1";
/** localStorage key the saved layout templates live under (owned by Hud.tsx). */
export const TEMPLATES_KEY = "rcw.hud.templates.v1";

export function loadAutoLayout(): AutoLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<AutoLayout>;
    return {
      enabled: !!raw.enabled,
      breakpoint: typeof raw.breakpoint === "number" && raw.breakpoint > 0 ? raw.breakpoint : DEFAULT_AUTOLAYOUT.breakpoint,
      global: { laptop: raw.global?.laptop ?? null, desktop: raw.global?.desktop ?? null },
      perSession: raw.perSession && typeof raw.perSession === "object" ? raw.perSession : {},
    };
  } catch {
    return { ...DEFAULT_AUTOLAYOUT };
  }
}

export function saveAutoLayout(a: AutoLayout): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("rcw-autolayout", { detail: a }));
}

/** The physical width of the display the app is on (falls back to the viewport). */
export function currentScreenWidth(): number {
  if (typeof window === "undefined") return 1920;
  return window.screen?.width || window.innerWidth || 1920;
}

/** Classify the current screen against the breakpoint. */
export function screenClass(breakpoint: number): ScreenClass {
  return currentScreenWidth() <= breakpoint ? "laptop" : "desktop";
}

/** Resolve which template applies to a session for a class: per-session, else global. */
export function resolveTemplate(a: AutoLayout, sessionId: string, cls: ScreenClass): string | null {
  return a.perSession[sessionId]?.[cls] ?? a.global[cls] ?? null;
}

/** Live-updating auto-layout config (re-renders on save from anywhere). */
export function useAutoLayout(): AutoLayout {
  const [a, setA] = useState<AutoLayout>(loadAutoLayout);
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent<AutoLayout>).detail;
      setA(detail ?? loadAutoLayout());
    };
    window.addEventListener("rcw-autolayout", h);
    return () => window.removeEventListener("rcw-autolayout", h);
  }, []);
  return a;
}

/** Names of the saved layout templates + whether each is a grid or windows layout. */
export function loadTemplateNames(): { name: string; kind: "win" | "grid" }[] {
  try {
    const t = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}") as Record<string, { layout?: string }>;
    return Object.keys(t).sort().map((name) => ({ name, kind: t[name]?.layout === "windows" ? "win" : "grid" }));
  } catch {
    return [];
  }
}
