// Reliable "open in a new tab" for <webview> guests, driven entirely from the
// renderer so it takes effect on a plain reload (no full app relaunch needed) and
// doesn't depend on the webview's `allowpopups` (which can silently block
// window.open / target=_blank so a click does nothing).
//
// We inject a click interceptor into the guest that, on a new-tab intent
// (target=_blank, middle-click, or ⌘/Ctrl-click), signals the URL back over the
// guest's console — the one channel a preload-less guest has that the host receives
// verbatim and per-message. (We previously used a document.title marker, but
// Chromium debounces title-change notifications: setting the title and reverting it
// in the same frame often emits ONLY the reverted title, so the marker was dropped
// and the tab never opened.) The host webview fires `console-message`, caught here.

export const OPEN_TAB_MARK = "__RCW_OPEN_TAB__::";

export const OPEN_TAB_JS = `(() => {
  if (window.__rcwOpenTab) return; window.__rcwOpenTab = true;
  const MARK = ${JSON.stringify(OPEN_TAB_MARK)};
  const signal = (raw) => {
    try {
      if (!raw) return;
      const abs = new URL(raw, location.href).href;
      if (!/^https?:/i.test(abs)) return;
      console.log(MARK + abs);
    } catch (e) {}
  };
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0 && e.button !== 1) return;
    let el = e.target;
    while (el && el.nodeName !== 'A') el = el.parentElement;
    if (!el || !el.href) return;
    const target = (el.getAttribute('target') || '').toLowerCase();
    const wantNew = target === '_blank' || e.button === 1 || e.metaKey || e.ctrlKey;
    if (!wantNew) return;
    e.preventDefault(); e.stopPropagation();
    signal(el.href);
  }, true);
})();`;

/** Minimal shape of the <webview> element bits we use here. */
type WV = HTMLElement & { executeJavaScript(code: string): Promise<unknown> };

/**
 * Wire new-tab interception onto a <webview>: (re)inject the interceptor on every
 * document, and translate the console-marker signal into `onUrl(url)`. Returns a
 * cleanup fn. Safe to call once the element is mounted.
 */
export function wireOpenTab(wv: WV, onUrl: (url: string) => void): () => void {
  const inject = () => { try { void wv.executeJavaScript(OPEN_TAB_JS); } catch { /* not ready */ } };
  const onConsole = (e: Event) => {
    const msg = (e as unknown as { message?: string }).message;
    if (typeof msg === "string" && msg.startsWith(OPEN_TAB_MARK)) onUrl(msg.slice(OPEN_TAB_MARK.length));
  };
  inject();
  wv.addEventListener("dom-ready", inject as EventListener);
  wv.addEventListener("did-navigate", inject as EventListener);
  wv.addEventListener("did-navigate-in-page", inject as EventListener);
  wv.addEventListener("console-message", onConsole as EventListener);
  return () => {
    wv.removeEventListener("dom-ready", inject as EventListener);
    wv.removeEventListener("did-navigate", inject as EventListener);
    wv.removeEventListener("did-navigate-in-page", inject as EventListener);
    wv.removeEventListener("console-message", onConsole as EventListener);
  };
}
