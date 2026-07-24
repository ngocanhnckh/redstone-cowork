import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionView } from "../types";

// Re-login Claude, the easy way. Instead of making the user SSH in and juggle the TUI,
// this drives Claude Code's `/login` for them: types `/login` into the session, scrapes
// the OAuth URL out of the pane so they can open it in their real browser with one click,
// then types the pasted code back — Claude persists the credentials on the host itself.

const DOMAIN_RE = /(?:claude\.(?:ai|com)|anthropic\.com)/i;
const OK_RE = /login successful|logged in|successfully (?:logged|authenticated)|authentication successful/i;

/** Pull the OAuth URL out of the captured pane. Claude hard-wraps the (long) URL across
 *  several 80-col lines with real newlines, so we find the line that starts the URL, then
 *  stitch on the following lines while they're entirely non-whitespace (URL continuation)
 *  — the next real line ("Paste code here…") is indented, which stops the join. */
function extractLoginUrl(pane: string): string | null {
  const lines = pane.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/^https?:\/\//i.test(t) || !DOMAIN_RE.test(t)) continue;
    let url = t;
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (raw.length === 0 || /\s/.test(raw)) break; // continuation lines contain no spaces
      url += raw.trim();
    }
    return url;
  }
  return null;
}
// The "Select login method" menu that `/login` shows first — option 1 is "Claude account
// with subscription". We press Enter to accept the default once we see it.
const MENU_RE = /select login method|claude account with subscription|anthropic console account|log in with (?:your )?claude/i;

const CSS = `
.clg-scrim { position:fixed; inset:0; z-index:200; background:rgb(4 8 12 / .6); backdrop-filter:blur(4px);
  display:flex; align-items:center; justify-content:center; }
.clg { width:min(500px,94vw); border-radius:16px; border:1px solid var(--border); overflow:hidden;
  background: color-mix(in srgb, var(--app-panel) 96%, transparent); box-shadow:0 30px 80px rgb(0 0 0 / .6); }
.clg-head { display:flex; align-items:center; gap:10px; padding:14px 18px; border-bottom:1px solid var(--border); }
.clg-head b { font-size:13px; letter-spacing:.14em; color:rgb(var(--primary-soft)); }
.clg-body { padding:16px 18px; }
.clg-step { display:flex; gap:11px; margin-bottom:14px; }
.clg-num { width:22px; height:22px; flex-shrink:0; border-radius:50%; border:1px solid rgb(var(--primary) / .5);
  color:rgb(var(--primary-soft)); font-size:11px; display:flex; align-items:center; justify-content:center; font-weight:700; }
.clg-num.on { background:rgb(var(--primary) / .2); }
.clg-num.ok { background:#1f7a3d; border-color:#2f9d52; color:#dfffe9; }
.clg-t { font-size:12.5px; color:var(--text-soft); line-height:1.5; }
.clg-t b { color:var(--text); }
.clg-input { width:100%; box-sizing:border-box; background:rgb(0 0 0 / .3); border:1px solid var(--border);
  border-radius:9px; color:var(--text); padding:9px 11px; font-size:12.5px; font-family:var(--font-mono); margin-top:8px; }
.clg-row { display:flex; gap:8px; margin-top:8px; }
.clg-btn { border:0; border-radius:9px; padding:8px 14px; font-size:11px; font-weight:700; letter-spacing:.08em;
  cursor:pointer; background:rgb(var(--primary) / .9); color:#05121a; white-space:nowrap; }
.clg-btn:disabled { opacity:.5; cursor:default; }
.clg-btn.ghost { background:transparent; border:1px solid var(--border); color:var(--text-soft); font-weight:600; }
.clg-note { font-size:11px; color:var(--text-faint); margin-top:6px; line-height:1.5; }
.clg-ok { color:#7fd18b; font-size:13px; font-weight:600; }
.clg-err { color:#e0736a; font-size:11.5px; margin-top:6px; }
`;

export default function ClaudeLoginModal({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const [phase, setPhase] = useState<"intro" | "waiting" | "link" | "done">("intro");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sentCode, setSentCode] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triesRef = useRef(0);
  const menuDone = useRef(false); // have we already pressed Enter on the login-method menu?

  const stopPoll = useCallback(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, []);
  useEffect(() => stopPoll, [stopPoll]);

  const poll = useCallback(async () => {
    if (!session.wrapperId) return;
    triesRef.current += 1;
    try {
      const pane = await window.cowork.claudeCapturePane(session.machine, session.wrapperId);
      if (OK_RE.test(pane)) { setPhase("done"); stopPoll(); return; }
      const found = extractLoginUrl(pane);
      if (found) { setUrl((u) => u || found); setPhase((p) => (p === "waiting" ? "link" : p)); return; }
      // No URL yet — if the "Select login method" menu is showing, accept option 1
      // (Claude account with subscription) by pressing Enter, once.
      if (!menuDone.current && MENU_RE.test(pane)) {
        menuDone.current = true;
        await window.cowork.claudeSendKeys(session.machine, session.wrapperId, { enter: true });
      }
    } catch { /* ignore — manual fallback stays available */ }
    if (triesRef.current > 45) stopPoll(); // ~80s
  }, [session.machine, session.wrapperId, stopPoll]);

  const start = async () => {
    if (!session.wrapperId) return;
    setErr(""); setBusy(true); setPhase("waiting"); triesRef.current = 0; menuDone.current = false;
    try {
      // Type `/login` + Enter straight into the Claude TUI. The menu-confirm Enter is
      // sent by the poller once it sees the "Select login method" screen.
      await window.cowork.claudeSendKeys(session.machine, session.wrapperId, { text: "/login", enter: true });
      stopPoll();
      pollRef.current = setInterval(poll, 1800);
      setTimeout(() => void poll(), 900);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const copy = () => { if (url) { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1400); } };
  const openBrowser = () => { if (url) window.cowork.openExternal?.(url); };

  const sendCode = async () => {
    const c = code.trim();
    if (!c || !session.wrapperId) return;
    setErr(""); setBusy(true);
    try {
      await window.cowork.claudeSendKeys(session.machine, session.wrapperId, { text: c, enter: true });
      setSentCode(true);
      // Watch for the success line.
      stopPoll(); triesRef.current = 0;
      pollRef.current = setInterval(poll, 1800);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const s2on = phase === "link" || phase === "done";
  return (
    <div className="clg-scrim" onClick={onClose}>
      <style>{CSS}</style>
      <div className="clg" onClick={(e) => e.stopPropagation()}>
        <div className="clg-head">
          <span style={{ fontSize: 16 }}>🔐</span>
          <b>RE-LOGIN CLAUDE</b>
          <span style={{ flex: 1 }} />
          <button className="clg-btn ghost" style={{ padding: "5px 11px" }} onClick={onClose}>CLOSE</button>
        </div>
        <div className="clg-body">
          {!session.wrapperId && (
            <div className="clg-err" style={{ marginBottom: 10 }}>This session isn't a redstone-wrapped Claude session, so automated login isn't available here.</div>
          )}

          {phase === "done" ? (
            <div style={{ textAlign: "center", padding: "18px 0" }}>
              <div style={{ fontSize: 34 }}>✅</div>
              <div className="clg-ok" style={{ marginTop: 8 }}>Claude is logged in on this session.</div>
              <div className="clg-note">Credentials are saved on the host — you won't need to do this again until it expires.</div>
              <button className="clg-btn" style={{ marginTop: 14 }} onClick={onClose}>DONE</button>
            </div>
          ) : (
            <>
              {/* Step 1 — start */}
              <div className="clg-step">
                <div className={`clg-num ${phase !== "intro" ? "ok" : "on"}`}>{phase !== "intro" ? "✓" : "1"}</div>
                <div className="clg-t">
                  <b>Start the login</b> — the app types <code>/login</code> into this session for you.
                  {phase === "intro" && (
                    <div className="clg-row">
                      <button className="clg-btn" disabled={busy || !session.wrapperId} onClick={start}>{busy ? "…" : "▸ START LOGIN"}</button>
                    </div>
                  )}
                  {phase === "waiting" && <div className="clg-note">Waiting for Claude to produce the login link… (if nothing appears, paste it below from the Terminal pane)</div>}
                </div>
              </div>

              {/* Step 2 — open the link */}
              <div className="clg-step">
                <div className={`clg-num ${s2on ? "on" : ""}`}>2</div>
                <div className="clg-t" style={{ flex: 1, minWidth: 0 }}>
                  <b>Open the link &amp; authorize</b> in your browser.
                  <input className="clg-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://claude.ai/oauth/authorize… (auto-filled, or paste it here)" spellCheck={false} />
                  <div className="clg-row">
                    <button className="clg-btn" disabled={!url} onClick={openBrowser}>🌐 OPEN IN BROWSER</button>
                    <button className="clg-btn ghost" disabled={!url} onClick={copy}>{copied ? "✓ COPIED" : "COPY LINK"}</button>
                  </div>
                </div>
              </div>

              {/* Step 3 — paste code */}
              <div className="clg-step">
                <div className={`clg-num ${sentCode ? "ok" : s2on ? "on" : ""}`}>{sentCode ? "✓" : "3"}</div>
                <div className="clg-t" style={{ flex: 1, minWidth: 0 }}>
                  <b>Paste the code back</b> — after authorizing you'll get a code. Paste it and the app types it into the session.
                  <input className="clg-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="paste the authorization code" spellCheck={false}
                    onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) sendCode(); }} />
                  <div className="clg-row">
                    <button className="clg-btn" disabled={busy || !code.trim()} onClick={sendCode}>{sentCode ? "↻ RESEND CODE" : "✓ SEND CODE TO CLAUDE"}</button>
                  </div>
                  {sentCode && <div className="clg-note">Sent — waiting for Claude to confirm the login…</div>}
                </div>
              </div>

              {err && <div className="clg-err">⚠ {err}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
