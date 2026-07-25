// CSS injected into a custom app's <webview> to restyle it to match the cockpit.
// Injected via webview.insertCSS() on dom-ready (see CustomAppPanel).
//
// SIGNAL ROOM edition: surfaces go transparent so the cockpit's dark glass shows
// through, text is forced to chalk, corners are squared, and the only color is
// signal red on links/focus/selection. Custom CSS is appended last and wins.

export type AppTheme = "off" | "dark" | "hitech";

const CHALK = "#e8e6e1"; // cockpit ink
const RED = "#e63b2e"; // signal red — the one accent

// Base "see-through dark": mostly-opaque dark base on <html>, strip element
// backgrounds so the base shows through, force text to chalk. Media (img/video/
// canvas/svg) keep their own paint.
const BASE = `
html { background-color: rgba(6,6,6,0.12) !important; background-image: none !important; }
body { background: transparent !important; background-image: none !important; }
body *:not(img):not(video):not(canvas):not(svg):not(svg *):not(picture) {
  background-color: transparent !important;
}
body, body *:not(svg):not(svg *):not(path) { color: ${CHALK} !important; }
body *:not(svg):not(svg *) { border-color: rgba(232,230,225,0.14) !important; }
/* Overlay surfaces (menus, dropdowns, popovers, tooltips, dialogs) float over
   other content — give them a solid frosted-dark background. */
[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="alertdialog"], [role="combobox"], [role="grid"][aria-label],
[class*="menu" i]:not([class*="menubar" i]):not([class*="menu-bar" i]), [class*="dropdown" i], [class*="popover" i], [class*="popup" i],
[class*="flyout" i], [class*="submenu" i], [class*="tooltip" i], [class*="dialog" i], [class*="modal" i],
[class*="picker" i], [class*="combobox" i], [class*="autocomplete" i], [class*="typeahead" i], [class*="layer" i], [class*="portal" i],
[class*="context" i][class*="menu" i], [class*="select__menu" i], [class*="dropdown-menu" i], [class*="MenuList" i], [class*="Popper" i],
[data-testid*="menu" i], [data-testid*="dropdown" i], [data-testid*="popup" i], [data-testid*="popover" i], [data-testid*="dialog" i],
[data-ds--menu], [data-focus-lock], [id*="menu" i][role], [id*="popup" i], [id*="dropdown" i] {
  background-color: rgba(10,10,10,0.96) !important;
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.55) !important;
  border: 1px solid rgba(232,230,225,0.16) !important;
}
input, textarea, select, [contenteditable="true"], [role="textbox"] {
  background-color: rgba(255,255,255,0.06) !important;
  color: ${CHALK} !important;
  caret-color: ${RED} !important;
}
::placeholder { color: rgba(232,230,225,0.4) !important; }
::selection { background: ${RED} !important; color: #fff !important; }
`;

// The full register: squared corners, red links/focus, square dark scrollbars.
// (Kept under the stored "hitech" value so existing app configs keep working.)
const SIGNAL = `
*, *::before, *::after { border-radius: 0 !important; }
a, a *, [role="link"] { color: ${CHALK} !important; text-decoration-color: ${RED} !important; }
:focus-visible { outline: 1px solid ${RED} !important; outline-offset: 1px; }
* { scrollbar-color: #242424 transparent; scrollbar-width: thin; }
::-webkit-scrollbar { width: 7px; height: 7px; }
::-webkit-scrollbar-thumb { background: #242424 !important; border-radius: 0 !important; }
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
  else if (theme === "hitech") parts.push(BASE, SIGNAL);
  const trimmed = (custom ?? "").trim();
  if (trimmed) parts.push(trimmed);
  return parts.join("\n");
}
