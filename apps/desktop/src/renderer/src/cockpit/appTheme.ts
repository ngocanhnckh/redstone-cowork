// CSS injected into a custom app's <webview> to restyle it to match the cockpit.
// Injected via webview.insertCSS() on dom-ready (see CustomAppPanel). The guest page
// can't read our CSS variables, so accent values are hard-coded to the hi-tech cyan.

export type AppTheme = "off" | "dark" | "hitech";

// Hi-tech cyan accent (matches the [data-theme="hitech"] --accent family).
const CYAN = "#54e6ff";

// Universal "dark mode" by inversion (Dark-Reader-lite): invert the whole document,
// spin the hue back so colours stay recognisable, then RE-invert media so photos,
// videos, canvases and background images render normally. Works on ANY site with no
// per-site knowledge — approximate, but reliable.
const DARK = `
html { background: #0e0d0c !important; }
html { filter: invert(1) hue-rotate(180deg) !important; }
img, video, picture, canvas, svg image, [style*="background-image"],
[class*="avatar"], [class*="logo"], iframe, embed, object {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;

// The hi-tech pass, layered on top of DARK: cyan accents on interactive chrome, cyan
// text selection and scrollbars, and a NON-INTERACTIVE scanline + vignette overlay so
// the app still works underneath. Kept selector-broad so it lands on arbitrary sites.
const HITECH_EXTRA = `
::selection { background: ${CYAN}66 !important; color: #eafcff !important; }
a, a * { color: ${CYAN} !important; }
button, [role="button"], input[type="submit"], input[type="button"] {
  border-color: ${CYAN}55 !important;
}
:focus, :focus-visible {
  outline-color: ${CYAN} !important;
  box-shadow: 0 0 0 1px ${CYAN}66 !important;
}
* { scrollbar-color: ${CYAN}88 transparent; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: ${CYAN}66; border-radius: 6px; }
::-webkit-scrollbar-track { background: transparent; }
/* Scanline + vignette overlay — the DARK filter re-inverts this ::after because it
   sits inside <html>, so we pre-invert the colours here to survive that. Fixed,
   full-viewport, pointer-events:none so clicks pass through to the app. */
html::after {
  content: "" !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  mix-blend-mode: screen !important;
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(120,220,255,0.05) 3px),
    radial-gradient(120% 100% at 50% 50%, transparent 62%, rgba(0,40,60,0.35) 100%) !important;
}
`;

/**
 * The full stylesheet for an app given its theme + optional custom CSS. Custom CSS is
 * appended LAST so it always wins. Returns "" when there's nothing to inject.
 */
export function themeCss(theme: AppTheme | undefined, custom?: string | null): string {
  const parts: string[] = [];
  if (theme === "dark") parts.push(DARK);
  else if (theme === "hitech") parts.push(DARK, HITECH_EXTRA);
  const trimmed = (custom ?? "").trim();
  if (trimmed) parts.push(trimmed);
  return parts.join("\n");
}
