// Password autofill + save-detection for <webview> guests, driven from the renderer
// (no guest preload needed) — same pattern as openTabIntercept: inject a script on
// each document, and signal captured credentials back via a distinctive
// document.title marker (the one channel a preload-less guest has).

export const CRED_MARK = "__RCW_CRED__::";

/** Fill the first username/password pair on the page with saved values. Safe to run
 * repeatedly (idempotent per document). Values are JSON-escaped into the script. */
export function fillJs(username: string, password: string): string {
  return `(() => {
    try {
      const U = ${JSON.stringify(username)}, P = ${JSON.stringify(password)};
      const pw = document.querySelector('input[type=password]');
      if (!pw) return;
      const set = (el, v) => {
        if (!el || el.value) return;
        const proto = Object.getPrototypeOf(el);
        const d = Object.getOwnPropertyDescriptor(proto, 'value');
        d && d.set ? d.set.call(el, v) : (el.value = v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      // Find a username field: the closest preceding text/email/tel input in the form.
      let user = null;
      const form = pw.form;
      const scope = form || document;
      const cands = [...scope.querySelectorAll('input')].filter(i =>
        ['text','email','tel',''].includes((i.getAttribute('type')||'').toLowerCase()) &&
        i.type !== 'password' && i.offsetParent !== null);
      user = cands.length ? cands[cands.length - 1] : null;
      set(user, U);
      set(pw, P);
    } catch (e) {}
  })();`;
}

/** Watch for a login submit; when a password field is filled and the form submits,
 * signal {u,p} back via the title marker so the host can offer to save it. */
export const SAVE_DETECT_JS = `(() => {
  if (window.__rcwCred) return; window.__rcwCred = true;
  const MARK = ${JSON.stringify(CRED_MARK)};
  const signal = (u, p) => {
    try {
      if (!p) return;
      const prev = document.title;
      document.title = MARK + btoa(unescape(encodeURIComponent(JSON.stringify({ u: u || '', p }))));
      setTimeout(() => { try { document.title = prev; } catch (e) {} }, 0);
    } catch (e) {}
  };
  const capture = () => {
    const pw = document.querySelector('input[type=password]');
    if (!pw || !pw.value) return;
    const scope = pw.form || document;
    const cands = [...scope.querySelectorAll('input')].filter(i =>
      ['text','email','tel',''].includes((i.getAttribute('type')||'').toLowerCase()) && i.type !== 'password');
    const user = cands.length ? cands[cands.length - 1].value : '';
    signal(user, pw.value);
  };
  // Capture on submit (covers most forms) and on Enter in a password field.
  document.addEventListener('submit', capture, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.type === 'password') capture();
  }, true);
})();`;

/** Decode a title-marker credential signal, or null if the title isn't one. */
export function decodeCred(title: string): { username: string; password: string } | null {
  if (!title.startsWith(CRED_MARK)) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(title.slice(CRED_MARK.length)))));
    if (obj && typeof obj.p === "string") return { username: String(obj.u ?? ""), password: obj.p };
  } catch { /* ignore */ }
  return null;
}
