// CSS injected into a custom app's <webview> to restyle it to match the cockpit.
// Injected via webview.insertCSS() on dom-ready (see CustomAppPanel).
//
// Strategy: instead of inverting colours (which turns already-DARK sites light), we
// make the app's own surfaces TRANSPARENT and force text light. The cockpit's dark
// glass panel then shows THROUGH the page (the translucent hi-tech look), and it reads
// the same whether the site was originally light or dark. Custom CSS is appended last
// (and, since there's no filter now, its colours behave intuitively).

export type AppTheme = "off" | "dark" | "hitech";

const LIGHT = "#e6f2f4";   // readable light text on the dark cockpit backdrop
const CYAN = "#54e6ff";    // hi-tech accent (matches [data-theme="hitech"])

// Base "see-through dark": put a mostly-opaque dark base on <html> (so the page is dark
// even if the webview can't composite transparently), STRIP every element's own
// background so that dark base shows through, and force text light. The html base is
// slightly translucent, so where the webview IS transparent the cockpit glass bleeds
// through for the hi-tech look. Media (img/video/canvas/svg) keep their own paint.
const BASE = `
html { background-color: rgba(9,12,16,0.12) !important; background-image: none !important; }
body { background: transparent !important; background-image: none !important; }
body *:not(img):not(video):not(canvas):not(svg):not(svg *):not(picture) {
  background-color: transparent !important;
}
body, body *:not(svg):not(svg *):not(path) { color: ${LIGHT} !important; }
body *:not(svg):not(svg *) { border-color: rgba(230,242,244,0.14) !important; }
/* Overlay surfaces (menus, dropdowns, popovers, tooltips, dialogs) must stay readable
   since they FLOAT over other content — give them a SOLID frosted-dark background
   instead of the stripped-transparent one. Matched broadly by role / class / data-attr
   / id across common UI frameworks (Atlaskit, MUI, Radix, etc.). Class/attr selectors
   win over the strip rule on specificity, so this always takes effect. */
[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="alertdialog"], [role="combobox"], [role="grid"][aria-label],
[class*="menu" i]:not([class*="menubar" i]):not([class*="menu-bar" i]), [class*="dropdown" i], [class*="popover" i], [class*="popup" i],
[class*="flyout" i], [class*="submenu" i], [class*="tooltip" i], [class*="dialog" i], [class*="modal" i],
[class*="picker" i], [class*="combobox" i], [class*="autocomplete" i], [class*="typeahead" i], [class*="layer" i], [class*="portal" i],
[class*="context" i][class*="menu" i], [class*="select__menu" i], [class*="dropdown-menu" i], [class*="MenuList" i], [class*="Popper" i],
[data-testid*="menu" i], [data-testid*="dropdown" i], [data-testid*="popup" i], [data-testid*="popover" i], [data-testid*="dialog" i],
[data-ds--menu], [data-focus-lock], [id*="menu" i][role], [id*="popup" i], [id*="dropdown" i] {
  background-color: rgba(11,15,21,0.96) !important;
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  backdrop-filter: blur(16px) saturate(1.3);
  box-shadow: 0 12px 40px rgba(0,0,0,0.55) !important;
}
input, textarea, select, [contenteditable="true"], [role="textbox"] {
  background-color: rgba(255,255,255,0.06) !important;
  color: ${LIGHT} !important;
}
::placeholder { color: rgba(230,242,244,0.45) !important; }
::selection { background: rgba(84,230,255,0.30) !important; color: #eafcff !important; }
`;

// Hi-tech adds cyan accents on links/focus/scrollbars (no filter, so cyan stays cyan).
const HITECH = `
a, a *, [role="link"] { color: ${CYAN} !important; }
:focus-visible { outline: 1px solid ${CYAN} !important; outline-offset: 1px; }
* { scrollbar-color: ${CYAN}88 transparent; scrollbar-width: thin; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: ${CYAN}66 !important; border-radius: 6px; }
::-webkit-scrollbar-track { background: transparent !important; }
`;

/** True when a theme is active (so the panel makes its webview transparent to match). */
export function isThemed(theme: AppTheme | undefined): boolean {
  return theme === "dark" || theme === "hitech";
}

/**
 * The full stylesheet for an app given its theme + optional custom CSS. Custom CSS is
 * appended LAST so it always wins. Returns "" when there's nothing to inject.
 */
export function themeCss(theme: AppTheme | undefined, custom?: string | null): string {
  const parts: string[] = [];
  if (theme === "dark") parts.push(BASE);
  else if (theme === "hitech") parts.push(BASE, HITECH);
  const trimmed = (custom ?? "").trim();
  if (trimmed) parts.push(trimmed);
  return parts.join("\n");
}
