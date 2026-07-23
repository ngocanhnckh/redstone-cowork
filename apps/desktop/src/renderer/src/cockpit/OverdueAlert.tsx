import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { playSfx } from "../sfx";

/**
 * OVERDUE QUESTION ALARM. When a session has been waiting on the user for longer than
 * OVERDUE_MS (15 min), a futuristic red alert slides in and an electronic alarm sounds
 * so the user goes and answers it. Re-alarms periodically while still overdue. Jumping
 * to the session or snoozing it clears the alert; the focused session never alarms.
 */

const OVERDUE_MS = 15 * 60_000;
const REALARM_MS = 90_000; // re-sound every 90s while a question stays overdue
const CHECK_MS = 20_000;

const projectName = (cwd: string): string => cwd.split("/").filter(Boolean).pop() ?? cwd;

const CSS = `
@keyframes oa-in { from { opacity:0; transform: translateX(30px) scale(.95); } to { opacity:1; transform:none; } }
@keyframes oa-throb { 0%,100% { box-shadow: 0 18px 50px rgb(0 0 0 / .55), 0 0 0 1px rgb(255 90 80 / .3), 0 0 22px -6px rgb(255 90 80 / .5); }
  50% { box-shadow: 0 18px 50px rgb(0 0 0 / .55), 0 0 0 1px rgb(255 90 80 / .7), 0 0 40px 0 rgb(255 90 80 / .8); } }
@keyframes oa-beacon { 0%,100% { opacity:.35; } 50% { opacity:1; } }
.oa-wrap { position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:120; display:flex; flex-direction:column; gap:10px; width:min(560px, 92vw); pointer-events:none; }
.oa-card { pointer-events:auto; position:relative; overflow:hidden; border-radius:14px; padding:13px 15px;
  border:1px solid rgb(255 90 80 / .6); background: color-mix(in srgb, #1a0e0d 92%, transparent);
  -webkit-backdrop-filter: blur(26px) saturate(1.4); backdrop-filter: blur(26px) saturate(1.4);
  font-family:var(--font-mono); animation: oa-in .3s cubic-bezier(.2,.9,.2,1) both, oa-throb 1.8s ease-in-out infinite; }
.oa-top { display:flex; align-items:center; gap:9px; }
.oa-beacon { width:9px; height:9px; border-radius:50%; background:#ff5a50; box-shadow:0 0 12px #ff5a50; animation: oa-beacon 1s ease-in-out infinite; flex-shrink:0; }
.oa-kick { font-size:9.5px; letter-spacing:.32em; color:#ff8a82; font-weight:700; }
.oa-mins { margin-left:auto; font-size:10px; letter-spacing:.14em; color:#ffb4ae; }
.oa-title { font-size:13px; font-weight:700; color:#ffe9e7; margin:6px 0 2px; }
.oa-sub { font-size:10.5px; color: rgb(255 210 206 / .7); letter-spacing:.04em; }
.oa-row { display:flex; gap:8px; margin-top:11px; }
.oa-jump { flex:1; border:1px solid rgb(255 90 80 / .6); background: rgb(255 90 80 / .2); color:#ffece9; border-radius:9px;
  padding:7px 12px; font-size:11.5px; font-weight:700; letter-spacing:.16em; cursor:pointer; font-family:inherit; }
.oa-jump:hover { background: rgb(255 90 80 / .34); }
.oa-x { border:1px solid var(--border); background:transparent; color:var(--text-soft); border-radius:9px; padding:7px 12px; font-size:11px; cursor:pointer; font-family:inherit; }
.oa-x:hover { color:#fff; }
`;

export default function OverdueAlert() {
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const focusId = useStore((s) => s.focusId);
  const setFocus = useStore((s) => s.setFocus);
  const snooze = useStore((s) => s.snooze);

  const [, tick] = useState(0);
  const lastAlarmAt = useRef<Map<string, number>>(new Map());
  const dismissed = useRef<Set<string>>(new Set());

  // Re-evaluate on a timer (waitingSince ages even without new data).
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), CHECK_MS);
    return () => clearInterval(t);
  }, []);

  // waitingSince comes from the queue view; fall back to the session list.
  const waitingSince = new Map<string, string | null>();
  for (const s of [...sessions, ...queue]) if (s.waitingSince) waitingSince.set(s.id, s.waitingSince);

  const now = Date.now();
  const overdue = [...new Map([...sessions, ...queue].map((s) => [s.id, s])).values()]
    .filter((s) => s.status === "waiting" && s.id !== focusId && !dismissed.current.has(s.id))
    .map((s) => {
      const since = waitingSince.get(s.id) ?? s.waitingSince;
      const waitedMs = since ? now - new Date(since).getTime() : 0;
      return { s, waitedMs };
    })
    .filter((x) => x.waitedMs >= OVERDUE_MS)
    .sort((a, b) => b.waitedMs - a.waitedMs);

  // Sound the alarm when a session first goes overdue, then re-alarm periodically.
  useEffect(() => {
    let fire = false;
    for (const { s } of overdue) {
      const last = lastAlarmAt.current.get(s.id) ?? 0;
      if (now - last >= REALARM_MS) { lastAlarmAt.current.set(s.id, now); fire = true; }
    }
    // Clear alarm memory for sessions no longer overdue so a future wait re-alarms.
    const live = new Set(overdue.map((o) => o.s.id));
    for (const id of [...lastAlarmAt.current.keys()]) if (!live.has(id)) lastAlarmAt.current.delete(id);
    if (fire) playSfx("alarm");
  }); // runs each render; guarded by REALARM_MS

  if (!overdue.length) return null;

  return (
    <div className="oa-wrap">
      <style>{CSS}</style>
      {overdue.slice(0, 3).map(({ s, waitedMs }) => {
        const mins = Math.floor(waitedMs / 60_000);
        return (
          <div key={s.id} className="oa-card">
            <div className="oa-top">
              <span className="oa-beacon" />
              <span className="oa-kick">⚠ AWAITING YOUR RESPONSE</span>
              <span className="oa-mins">{mins} MIN UNANSWERED</span>
            </div>
            <div className="oa-title">{projectName(s.cwd)}</div>
            <div className="oa-sub">{s.machine} · a question has been waiting {mins} minutes — respond to keep the mission moving.</div>
            <div className="oa-row">
              <button className="oa-jump" onClick={() => { setFocus(s.id); dismissed.current.delete(s.id); }}>▸ GO TO SESSION</button>
              <button className="oa-x" onClick={() => { dismissed.current.add(s.id); snooze(s.id, 10); tick((n) => n + 1); }}>SNOOZE 10m</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
