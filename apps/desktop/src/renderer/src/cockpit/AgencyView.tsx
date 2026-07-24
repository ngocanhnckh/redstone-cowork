import { useEffect, useMemo, useRef, useState } from "react";
import { findRank } from "./ranks";
import type { AgencyMessage } from "../../../shared/agency";

// ——— AGENCY — organisation-wide arena ———
// The competitive heart of YITEC: agents ranked on a gamified "player card" (FIFA-style
// OVR + four sub-ratings) computed from real telemetry — token OUTPUT, ENDURANCE (time
// on task), MISSIONS (sessions) and TEMPO (throughput). Org IRC chat + DMs land in later
// slices; a tab bar is here so those slot in without a re-layout.

type Analytics = {
  accountId: string; username: string; displayName: string; role: string;
  photo: string | null; level: string; division: string;
  sessions: number; activeSessions: number; tokensInput: number; tokensOutput: number;
  estCostUsd: number; timeSpentMs: number; lastActiveAt: string | null;
};

// Log-scaled 1–99 rating so a single agent still gets a meaningful score (no roster-wide
// normalisation needed). cap = the value that reads as "world class" (≈99).
function rate(x: number, cap: number): number {
  if (x <= 0) return 1;
  const v = Math.round((99 * Math.log(1 + x)) / Math.log(1 + cap));
  return Math.max(1, Math.min(99, v));
}
const CAP = { output: 5_000_000, hours: 400, missions: 150, tempo: 150_000, complete: 120 };

type Stats = { OUT: number; END: number; MSN: number; TMP: number; CMP: number };
function ratingsFor(a: Analytics, completed: number): Stats {
  const hours = a.timeSpentMs / 3.6e6;
  const tempo = hours > 0.02 ? a.tokensOutput / hours : 0; // tokens/hr
  return {
    OUT: rate(a.tokensOutput, CAP.output),
    END: rate(hours, CAP.hours),
    MSN: rate(a.sessions, CAP.missions),
    TMP: rate(tempo, CAP.tempo),
    CMP: rate(completed, CAP.complete), // Jira tasks completed
  };
}
const ovrOf = (s: Stats): number => Math.round(s.OUT * 0.26 + s.END * 0.15 + s.MSN * 0.13 + s.TMP * 0.18 + s.CMP * 0.28);

function fmtK(n: number): string { return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n)); }
function fmtDur(ms: number): string {
  const h = ms / 3.6e6;
  if (h >= 1) return `${h.toFixed(h >= 10 ? 0 : 1)}h`;
  const m = ms / 6e4;
  return `${Math.max(0, Math.round(m))}m`;
}

// Card tier by OVR — colours the frame + badge (bronze → cyan → gold → holo).
function tierOf(ovr: number): { name: string; a: string; b: string; text: string } {
  if (ovr >= 88) return { name: "ELITE", a: "#ffe08a", b: "#e0a24a", text: "#3a2a06" };
  if (ovr >= 75) return { name: "VETERAN", a: "#8ff2ff", b: "#22d3ee", text: "#04121a" };
  if (ovr >= 55) return { name: "OPERATIVE", a: "#9fb6cf", b: "#5f768f", text: "#0a1120" };
  return { name: "TRAINEE", a: "#c9a27a", b: "#8a6a4a", text: "#1a1006" };
}

const CSS = `
@keyframes agc-shine { from { background-position: -160% 0; } to { background-position: 260% 0; } }
@keyframes agc-in { from { opacity:0; transform: translateY(10px) scale(.98); } to { opacity:1; transform:none; } }
.agc-root { height:100%; min-height:0; display:flex; flex-direction:column; font-family:var(--font-mono); }
.agc-tabs { display:flex; gap:6px; padding:12px 16px 0; flex-shrink:0; }
.agc-tab { padding:7px 15px; border-radius:9px 9px 0 0; font-size:11px; font-weight:700; letter-spacing:.2em; cursor:pointer;
  border:1px solid var(--border); border-bottom:none; background:transparent; color:var(--text-soft); }
.agc-tab.on { background: rgb(var(--primary) / 0.2); color:#fff; border-color: rgb(var(--primary) / 0.5); }
.agc-tab.soon { opacity:.5; cursor:default; }
.agc-hd { display:flex; align-items:baseline; gap:12px; padding:14px 18px 6px; }
.agc-hd h2 { font-family:var(--font-display); font-size:24px; margin:0; letter-spacing:.02em; color:#e6f2f4; }
.agc-grid { flex:1; min-height:0; overflow-y:auto; padding:14px 18px 26px;
  display:grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap:16px; align-content:start; }

.agc-card { position:relative; border-radius:16px; padding:2px; animation: agc-in .3s ease both; cursor:default;
  background: linear-gradient(160deg, var(--tier-a), var(--tier-b)); box-shadow: 0 16px 40px -16px rgb(0 0 0 / .7); }
.agc-card:hover { box-shadow: 0 20px 50px -14px var(--tier-b); }
.agc-inner { position:relative; overflow:hidden; border-radius:14px; padding:14px 14px 15px;
  background: linear-gradient(180deg, rgb(6 12 20 / .93), rgb(8 16 26 / .97)); }
.agc-inner::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background: linear-gradient(115deg, transparent 36%, rgb(255 255 255 / .14) 50%, transparent 64%); background-size: 220% 100%;
  animation: agc-shine 5s ease-in-out infinite; }
.agc-top { display:flex; gap:12px; }
.agc-ovr { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:52px; }
.agc-ovr b { font-family:var(--font-display); font-size:34px; line-height:.9; color: var(--tier-a); text-shadow: 0 0 14px var(--tier-b); }
.agc-ovr span { font-size:8px; letter-spacing:.22em; color: var(--text-soft); margin-top:2px; }
.agc-tier { display:inline-block; margin-top:6px; font-size:8px; font-weight:800; letter-spacing:.18em; padding:2px 7px; border-radius:5px;
  background: linear-gradient(180deg, var(--tier-a), var(--tier-b)); color: var(--tier-text); }
.agc-photo { width:60px; height:60px; border-radius:12px; object-fit:cover; border:1.5px solid var(--tier-b);
  box-shadow:0 0 18px -5px var(--tier-b); background:#05090d; margin-left:auto; }
.agc-photo.ph { display:flex; align-items:center; justify-content:center; font-size:26px; color: rgb(255 255 255 / .35); }
.agc-name { font-size:14px; font-weight:700; letter-spacing:.03em; color:#f0f7ff; margin-top:11px; line-height:1.15; }
.agc-sub { font-size:9.5px; letter-spacing:.1em; color: var(--text-faint); margin-top:2px; }
.agc-insignia { font-size:11px; letter-spacing:.24em; color:#ffd166; margin-top:4px; min-height:12px; }
.agc-stats { display:grid; grid-template-columns:1fr 1fr; gap:6px 12px; margin-top:12px; padding-top:11px; border-top:1px solid rgb(255 255 255 / .1); }
.agc-stat { display:flex; align-items:center; gap:7px; }
.agc-stat b { font-size:13px; color:#e6f2f4; width:22px; text-align:right; font-variant-numeric:tabular-nums; }
.agc-stat span { font-size:9px; letter-spacing:.12em; color: var(--text-soft); }
.agc-real { display:flex; justify-content:space-between; margin-top:11px; font-size:9px; letter-spacing:.06em; color: var(--text-faint); }
.agc-real b { color: rgb(var(--primary-soft)); font-weight:600; }
.agc-rankbadge { position:absolute; top:-9px; left:-9px; z-index:3; width:30px; height:30px; border-radius:50%;
  display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; font-family:var(--font-display);
  border:2px solid #06121a; box-shadow:0 4px 14px rgb(0 0 0 / .6); }

/* IRC chat */
.agx-chat { flex:1; min-height:0; display:flex; flex-direction:column; padding:0 18px 14px; }
.agx-log { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:2px; padding:8px 2px; font-size:13px; }
.agx-line { display:flex; gap:8px; padding:3px 8px; border-radius:7px; align-items:baseline; }
.agx-line:hover { background: rgb(var(--primary) / 0.06); }
.agx-ts { font-size:9.5px; color: var(--text-faint); font-variant-numeric:tabular-nums; flex-shrink:0; width:42px; }
.agx-who { font-weight:700; color: rgb(var(--primary-soft)); flex-shrink:0; }
.agx-who.me { color: rgb(var(--accent)); }
.agx-body { color: var(--text); word-break:break-word; min-width:0; }
.agx-compose { display:flex; gap:8px; margin-top:8px; }
.agx-input { flex:1; padding:11px 14px; border-radius:10px; font-size:13px; font-family:inherit;
  border:1px solid rgb(var(--primary) / 0.3); background: rgb(var(--primary) / 0.05); color: var(--text); outline:none; }
.agx-input:focus { border-color: rgb(var(--primary) / 0.7); }
.agx-send { padding:0 18px; border-radius:10px; border:1px solid rgb(var(--primary) / 0.6); cursor:pointer;
  background: rgb(var(--primary) / 0.2); color:#d9f7ff; font-family:inherit; font-size:12px; font-weight:700; letter-spacing:.18em; }
.agx-send:disabled { opacity:.4; cursor:not-allowed; }
`;

const MEDAL = ["linear-gradient(180deg,#ffe08a,#e0a24a)", "linear-gradient(180deg,#e6eef2,#9fb0bc)", "linear-gradient(180deg,#e0a878,#b5794a)"];

function StatRow({ label, val }: { label: string; val: number }) {
  return <div className="agc-stat"><b>{val}</b><span>{label}</span></div>;
}

function PlayerCard({ a, rank, completed }: { a: Analytics; rank: number; completed: number }) {
  const s = ratingsFor(a, completed);
  const ovr = ovrOf(s);
  const tier = tierOf(ovr);
  const rk = findRank(a.level);
  const style = { "--tier-a": tier.a, "--tier-b": tier.b, "--tier-text": tier.text } as React.CSSProperties;
  return (
    <div className="agc-card" style={style}>
      {rank <= 3 && <div className="agc-rankbadge" style={{ background: MEDAL[rank - 1], color: "#1a1006" }}>{rank}</div>}
      <div className="agc-inner">
        <div className="agc-top">
          <div className="agc-ovr">
            <b>{ovr}</b><span>OVR</span>
            <span className="agc-tier">{tier.name}</span>
          </div>
          {a.photo ? <img className="agc-photo" src={a.photo} alt={a.displayName} /> : <div className="agc-photo ph">◍</div>}
        </div>
        <div className="agc-name">{a.displayName || a.username}</div>
        <div className="agc-sub">@{a.username}{a.division ? ` · ${a.division}` : ""}</div>
        <div className="agc-insignia">{rk?.insignia ? `${rk.insignia}  ${rk.name}` : rk?.name ?? ""}</div>
        <div className="agc-stats">
          <StatRow label="OUTPUT" val={s.OUT} />
          <StatRow label="ENDURANCE" val={s.END} />
          <StatRow label="MISSIONS" val={s.MSN} />
          <StatRow label="TEMPO" val={s.TMP} />
          <StatRow label="COMPLETE" val={s.CMP} />
        </div>
        <div className="agc-real">
          <span><b>{fmtK(a.tokensInput + a.tokensOutput)}</b> tok</span>
          <span><b>{fmtDur(a.timeSpentMs)}</b> on task</span>
          <span><b>{completed}</b> done</span>
        </div>
      </div>
    </div>
  );
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Organisation-wide IRC channel — every agent shares one town square. Polls for new
 *  lines every 4s and appends incrementally via the afterId cursor. */
function OrgChat({ meUsername }: { meUsername: string | null }) {
  const [msgs, setMsgs] = useState<AgencyMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const lastId = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const append = (incoming: AgencyMessage[]) => {
    if (!incoming.length) return;
    setMsgs((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      const merged = [...cur, ...incoming.filter((m) => !seen.has(m.id))];
      lastId.current = merged[merged.length - 1]?.id ?? lastId.current;
      return merged;
    });
  };

  useEffect(() => {
    let alive = true;
    window.cowork.agencyChatList().then((m) => { if (alive) append(m); }).catch(() => {});
    const t = setInterval(() => {
      window.cowork.agencyChatList(lastId.current ?? undefined).then((m) => { if (alive) append(m); }).catch(() => {});
    }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const onScroll = () => {
    const el = logRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try { const m = await window.cowork.agencyChatPost(body); append([m]); setDraft(""); stick.current = true; }
    catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div className="agx-chat">
      <div className="agx-log no-scrollbar" ref={logRef} onScroll={onScroll}>
        {msgs.length === 0 && <div className="soft" style={{ padding: 12, fontSize: 12.5 }}>No transmissions yet — say hello to the agency.</div>}
        {msgs.map((m) => (
          <div key={m.id} className="agx-line">
            <span className="agx-ts">{hhmm(m.createdAt)}</span>
            <span className={`agx-who${m.from.username === meUsername ? " me" : ""}`}>{m.from.displayName}</span>
            <span className="agx-body">{m.body}</span>
          </div>
        ))}
      </div>
      <div className="agx-compose">
        <input className="agx-input" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Broadcast to the agency…" maxLength={4000} />
        <button className="agx-send" onClick={send} disabled={sending || !draft.trim()}>SEND</button>
      </div>
    </div>
  );
}

export default function AgencyView() {
  const [tab, setTab] = useState<"arena" | "chat" | "dms">("arena");
  const [rows, setRows] = useState<Analytics[] | null>(null);
  const [err, setErr] = useState("");
  const [meUsername, setMeUsername] = useState<string | null>(null);
  const [doneByAccount, setDoneByAccount] = useState<Record<string, number>>({});

  useEffect(() => {
    window.cowork.accountsMe().then((m) => {
      setMeUsername(m && "username" in m ? (m.username as string | null) : null);
    }).catch(() => {});
  }, []);

  // Real Jira workload — completed-task counts per agent (cached server-side, ~3min).
  useEffect(() => {
    let alive = true;
    const load = () => window.cowork.agencyJiraStats()
      .then((stats) => { if (alive) setDoneByAccount(Object.fromEntries(stats.map((s) => [s.accountId, s.completed]))); })
      .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => window.cowork.accountsAnalytics()
      .then((r) => { if (alive) { setRows(r as Analytics[]); setErr(""); } })
      .catch((e) => { if (alive) setErr(/403/.test(String(e)) ? "" : `Leaderboard unavailable (${e instanceof Error ? e.message : e})`); });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const ranked = useMemo(() => {
    const list = (rows ?? []).map((a) => ({ a, ovr: ovrOf(ratingsFor(a, doneByAccount[a.accountId] ?? 0)) }));
    return list.sort((x, y) => y.ovr - x.ovr).map((x) => x.a);
  }, [rows, doneByAccount]);

  return (
    <div className="agc-root">
      <style>{CSS}</style>
      <div className="agc-tabs">
        <button className={`agc-tab${tab === "arena" ? " on" : ""}`} onClick={() => setTab("arena")}>⬡ ARENA</button>
        <button className={`agc-tab${tab === "chat" ? " on" : ""}`} onClick={() => setTab("chat")}>◈ IRC CHAT</button>
        <button className="agc-tab soon" title="Coming soon">✉ DMs</button>
      </div>
      {tab === "arena" && (
        <>
          <div className="agc-hd">
            <h2>Agent Arena</h2>
            <span className="soft" style={{ fontSize: 11, letterSpacing: ".12em" }}>ranked by overall rating · updates live</span>
          </div>
          {err && <div style={{ padding: "0 18px 10px", color: "#ff9d94", fontSize: 12 }}>⚠ {err}</div>}
          {rows === null ? (
            <div className="soft" style={{ padding: 24, fontSize: 13 }}>Loading roster…</div>
          ) : ranked.length === 0 ? (
            <div className="soft" style={{ padding: 24, fontSize: 13 }}>No agents on the board yet.</div>
          ) : (
            <div className="agc-grid">
              {ranked.map((a, i) => <PlayerCard key={a.accountId} a={a} rank={i + 1} completed={doneByAccount[a.accountId] ?? 0} />)}
            </div>
          )}
        </>
      )}
      {tab === "chat" && (
        <>
          <div className="agc-hd">
            <h2>Agency IRC</h2>
            <span className="soft" style={{ fontSize: 11, letterSpacing: ".12em" }}>organisation-wide channel · #org</span>
          </div>
          <OrgChat meUsername={meUsername} />
        </>
      )}
    </div>
  );
}
