import { useEffect, useRef, useState } from "react";
import type { AgencyMessage } from "../../../shared/agency";
import { playSfx } from "../sfx";

// Agent-to-agent DMs: a thread panel (used inside the Arena dossier) and a global
// notifier that pings (sound + toast) when a DM arrives while you're elsewhere.

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** DM thread with one agent — live (4s poll), composer sends via agencyDmPost. */
export function AgentDmPanel({ accountId, name, meUsername }: { accountId: string; name: string; meUsername: string | null }) {
  const [msgs, setMsgs] = useState<AgencyMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = () => window.cowork.agencyDmList(accountId).then((m) => setMsgs(m)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [accountId]);
  useEffect(() => { const el = logRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try { const m = await window.cowork.agencyDmPost(accountId, body); setMsgs((c) => [...c, m]); setDraft(""); stick.current = true; }
    catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div className="agdm">
      <div className="mono agdm-hd">◈ DIRECT MESSAGE · {name}</div>
      <div className="agdm-log no-scrollbar" ref={logRef} onScroll={() => { const el = logRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {msgs.length === 0 && <div className="soft" style={{ fontSize: 11.5, padding: "8px 2px" }}>No messages yet — say hello.</div>}
        {msgs.map((m) => {
          const mine = m.from.username === meUsername;
          return (
            <div key={m.id} className={`agdm-msg${mine ? " me" : ""}`}>
              <div className="agdm-bubble">{m.body}</div>
              <div className="agdm-meta">{mine ? "you" : m.from.displayName} · {hhmm(m.createdAt)}</div>
            </div>
          );
        })}
      </div>
      <div className="agdm-compose">
        <input className="agdm-input" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={`Message ${name}…`} maxLength={4000} />
        <button className="agdm-send" onClick={send} disabled={sending || !draft.trim()}>SEND</button>
      </div>
      <style>{DM_CSS}</style>
    </div>
  );
}

/** Global DM notifier — polls threads; on a NEW inbound message, plays the message cue
 *  and shows a futuristic toast. Baseline is set on first poll (no ping for old mail). */
export function DmNotifier() {
  const [toast, setToast] = useState<{ from: string; body: string } | null>(null);
  const seen = useRef<Map<string, string> | null>(null); // channel → last message id
  const meUsername = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.cowork.accountsMe().then((m) => { if (m && "username" in m) meUsername.current = m.username; }).catch(() => {});
    const poll = async () => {
      try {
        const threads = await window.cowork.agencyDmThreads();
        const first = seen.current === null;
        if (first) seen.current = new Map();
        for (const t of threads) {
          const msgs = await window.cowork.agencyDmList(t.other.accountId).catch(() => []);
          const last = msgs[msgs.length - 1];
          if (!last) continue;
          const prev = seen.current!.get(t.channel);
          seen.current!.set(t.channel, last.id);
          // Ping only for a genuinely NEW inbound message (not our own, not the baseline).
          if (!first && prev !== last.id && last.from.username !== meUsername.current) {
            if (alive) { playSfx("message"); setToast({ from: last.from.displayName, body: last.body }); setTimeout(() => alive && setToast(null), 6000); }
          }
        }
      } catch { /* ignore */ }
    };
    poll();
    const iv = setInterval(poll, 8000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  if (!toast) return null;
  return (
    <div className="agdm-toast" onClick={() => setToast(null)}>
      <div className="agdm-toast-hd">◈ NEW DIRECT MESSAGE</div>
      <div className="agdm-toast-from">{toast.from}</div>
      <div className="agdm-toast-body">{toast.body.slice(0, 140)}{toast.body.length > 140 ? "…" : ""}</div>
      <style>{DM_CSS}</style>
    </div>
  );
}

const DM_CSS = `
.agdm { display:flex; flex-direction:column; border:1px solid var(--border); border-radius:14px; background: rgb(var(--primary) / .03); overflow:hidden; }
.agdm-hd { font-size:9px; letter-spacing:.22em; color: rgb(var(--primary-soft)); padding:11px 14px 6px; }
.agdm-log { max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:6px 14px; }
.agdm-msg { display:flex; flex-direction:column; align-items:flex-start; max-width:78%; }
.agdm-msg.me { align-self:flex-end; align-items:flex-end; }
.agdm-bubble { font-size:13px; line-height:1.5; color: var(--text); padding:8px 12px; border-radius:12px; border:1px solid var(--border); background: rgb(var(--primary) / .06); word-break:break-word; }
.agdm-msg.me .agdm-bubble { background: rgb(var(--accent) / .16); border-color: rgb(var(--accent) / .4); }
.agdm-meta { font-size:9px; color: var(--text-faint); margin-top:3px; letter-spacing:.04em; }
.agdm-compose { display:flex; gap:8px; padding:8px 12px 12px; }
.agdm-input { flex:1; padding:9px 13px; border-radius:10px; font-size:13px; font-family:inherit; border:1px solid rgb(var(--primary) / .3); background: rgb(var(--primary) / .05); color: var(--text); outline:none; }
.agdm-input:focus { border-color: rgb(var(--primary) / .7); }
.agdm-send { padding:0 16px; border-radius:10px; border:1px solid rgb(var(--primary) / .6); cursor:pointer; background: rgb(var(--primary) / .2); color:#d9f7ff; font-family:inherit; font-size:11px; font-weight:700; letter-spacing:.16em; }
.agdm-send:disabled { opacity:.4; cursor:not-allowed; }

@keyframes agdm-toast-in { from { opacity:0; transform: translateX(30px); } to { opacity:1; transform:none; } }
.agdm-toast { position:fixed; right:20px; bottom:20px; z-index:600; width:300px; max-width:80vw; padding:14px 16px; border-radius:14px; cursor:pointer; font-family:var(--font-mono);
  border:1px solid rgb(var(--primary) / .5); background: rgb(8 14 20 / .97); box-shadow:0 20px 60px -14px rgb(0 0 0 / .8), inset 0 0 40px -30px rgb(var(--primary-soft)); animation: agdm-toast-in .3s ease both; }
.agdm-toast-hd { font-size:9px; letter-spacing:.24em; color: rgb(var(--accent)); font-weight:700; }
.agdm-toast-from { font-size:14px; font-weight:700; color:#e6f2f4; margin-top:5px; }
.agdm-toast-body { font-size:12px; color: var(--text-soft); line-height:1.5; margin-top:4px; }
`;
