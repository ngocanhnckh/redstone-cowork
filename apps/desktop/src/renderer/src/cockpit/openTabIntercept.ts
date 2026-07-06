// Reliable "open in a new tab" for <webview> guests, driven entirely from the
// renderer so it takes effect on a plain reload (no full app relaunch needed) and
// doesn't depend on the webview's `allowpopups` (which can silently block
// window.open / target=_blank so a click does nothing).
//
// We inject a click interceptor into the guest that, on a new-tab intent
// (target=_blank, middle-click, or ⌘/Ctrl-click), signals the URL back via a
// distinctive document.title marker — the one channel a preload-less guest has.
// The host webview element fires `page-title-updated`, which we catch here.

export const OPEN_TAB_MARK = "__RCW_OPEN_TAB__::";

export const OPEN_TAB_JS = `(() => {
  if (window.__rcwOpenTab) return; window.__rcwOpenTab = true;
  const MARK = ${JSON.stringify(OPEN_TAB_MARK)};
  const signal = (raw) => {
    try {
      if (!raw) return;
      const abs = new URL(raw, location.href).href;
      if (!/^https?:/i.test(abs)) return;
      const prev = document.title;
      document.title = MARK + abs;
      setTimeout(() => { try { document.title = prev; } catch (e) {} }, 0);
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
 * document, and translate the title-marker signal into `onUrl(url)`. Returns a
 * cleanup fn. Safe to call once the element is mounted.
 */
export function wireOpenTab(wv: WV, onUrl: (url: string) => void): () => void {
  const inject = () => { try { void wv.executeJavaScript(OPEN_TAB_JS); } catch { /* not ready */ } };
  const onTitle = (e: Event) => {
    const title = (e as unknown as { title?: string }).title;
    if (typeof title === "string" && title.startsWith(OPEN_TAB_MARK)) onUrl(title.slice(OPEN_TAB_MARK.length));
  };
  inject();
  wv.addEventListener("dom-ready", inject as EventListener);
  wv.addEventListener("did-navigate", inject as EventListener);
  wv.addEventListener("did-navigate-in-page", inject as EventListener);
  wv.addEventListener("page-title-updated", onTitle as EventListener);
  return () => {
    wv.removeEventListener("dom-ready", inject as EventListener);
    wv.removeEventListener("did-navigate", inject as EventListener);
    wv.removeEventListener("did-navigate-in-page", inject as EventListener);
    wv.removeEventListener("page-title-updated", onTitle as EventListener);
  };
}
