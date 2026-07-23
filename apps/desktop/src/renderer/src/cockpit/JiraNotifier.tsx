import { useEffect, useRef, useState } from "react";
import { playSfx } from "../sfx";

/**
 * JIRA MISSION ALERTS. Polls the signed-in agent's Jira notifications (issues
 * assigned to them, any project). A new one slides in as a futuristic card with a
 * chime; clicking opens the issue in the browser. Dismiss clears the card and marks
 * everything seen server-side so it doesn't re-alert.
 */

type Notif = { id: string; issueKey: string; summary: string; event: string; status: string; actor: string; url: string; createdAt: string; seenAt: string | null };
const POLL_MS = 30_000;
const CSS = `
@keyframes jn-in { from { opacity:0; transform: translateX(28px) scale(.96); } to { opacity:1; transform:none; } }
@keyframes jn-sheen { from { background-position:-140% 0; } to { background-position:240% 0; } }
.jn-wrap { position:fixed; right:16px; bottom:16px; z-index:110; display:flex; flex-direction:column; gap:10px; width:min(380px,90vw); }
.jn-card { position:relative; overflow:hidden; border-radius:13px; padding:13px 14px; font-family:var(--font-mono);
  border:1px solid rgb(38 132 255 / .55); background: color-mix(in srgb, var(--app-panel) 93%, transparent);
  -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
  box-shadow: 0 18px 50px rgb(0 0 0 / .55), 0 0 22px -8px rgb(38 132 255 / .6); animation: jn-in .3s cubic-bezier(.2,.9,.2,1) both; }
.jn-card::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background: linear-gradient(115deg, transparent 32%, rgb(38 132 255 / .14) 50%, transparent 68%); background-size:220% 100%; animation: jn-sheen 3.8s ease-in-out infinite; }
.jn-top { display:flex; align-items:center; gap:8px; }
.jn-key { font-size:11px; font-weight:700; letter-spacing:.1em; color:#8fc0ff; }
.jn-kick { font-size:8.5px; letter-spacing:.24em; color:#6fa8ff; }
.jn-sum { font-size:12.5px; color:#e6f2f4; margin:6px 0 2px; line-height:1.35; }
.jn-meta { font-size:10px; color: rgb(230 242 244 / .55); }
.jn-row { display:flex; gap:8px; margin-top:10px; }
.jn-open { flex:1; border:1px solid rgb(38 132 255 / .6); background: rgb(38 132 255 / .2); color:#dcecff; border-radius:8px; padding:6px 12px; font-size:11px; font-weight:700; letter-spacing:.14em; cursor:pointer; font-family:inherit; }
.jn-x { border:1px solid var(--border); background:transparent; color:var(--text-soft); border-radius:8px; padding:6px 11px; font-size:11px; cursor:pointer; font-family:inherit; }
`;

export default function JiraNotifier() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const rows = await window.cowork.jiraNotifications();
        if (!alive) return;
        const unseen = rows.filter((n) => !n.seenAt);
        // Chime only when a genuinely new one arrives (after the first load).
        const fresh = unseen.some((n) => !seenIds.current.has(n.id));
        unseen.forEach((n) => seenIds.current.add(n.id));
        if (fresh && primed.current) playSfx("message");
        primed.current = true;
        setNotifs(unseen.slice(0, 4));
      } catch { /* not an account session — ignore */ }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!notifs.length) return null;

  const dismissAll = () => { setNotifs([]); window.cowork.jiraNotificationsSeen().catch(() => {}); };
  const open = (n: Notif) => { if (n.url) window.cowork.openExternal?.(n.url); };

  return (
    <div className="jn-wrap">
      <style>{CSS}</style>
      {notifs.map((n) => (
        <div key={n.id} className="jn-card">
          <div className="jn-top">
            <svg width="14" height="14" viewBox="0 0 32 32" fill="#6fa8ff" aria-hidden><path d="M16.4 2 6 12.4a1.4 1.4 0 0 0 0 2l10.4 10.4 4-4-8.4-8.4 4-4a1.4 1.4 0 0 0 0-2z"/><path opacity=".7" d="M25.6 11.2 20 16.8l-4 4 5.6 5.6a1.4 1.4 0 0 0 2 0l6-6a1.4 1.4 0 0 0 0-2z"/></svg>
            <span className="jn-key">{n.issueKey}</span>
            <span style={{ flex: 1 }} />
            <span className="jn-kick">MISSION UPDATE</span>
          </div>
          <div className="jn-sum">{n.summary || "(no summary)"}</div>
          <div className="jn-meta">{n.event.replace(/_/g, " ")}{n.status ? ` · ${n.status}` : ""}{n.actor ? ` · by ${n.actor}` : ""}</div>
          <div className="jn-row">
            {n.url && <button className="jn-open" onClick={() => open(n)}>▸ OPEN IN JIRA</button>}
            <button className="jn-x" onClick={dismissAll}>DISMISS</button>
          </div>
        </div>
      ))}
    </div>
  );
}
