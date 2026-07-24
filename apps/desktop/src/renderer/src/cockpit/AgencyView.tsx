import { useEffect, useMemo, useRef, useState } from "react";
import { findRank } from "./ranks";
import type { AgencyMessage } from "../../../shared/agency";
import AgencyProfile from "./AgencyProfile";
import { Tiles, Bars, GithubHeatmap } from "./agencyCharts";
import type { AgencyAgentDossier } from "../../../shared/agency";

// ——— AGENCY — organisation-wide arena ———
// The competitive heart of YITEC: agents ranked on a gamified "player card" (FIFA-style
// OVR + four sub-ratings) computed from real telemetry — token OUTPUT, ENDURANCE (time
// on task), MISSIONS (sessions) and TEMPO (throughput). Org IRC chat + DMs land in later
// slices; a tab bar is here so those slot in without a re-layout.

// Scorecard model lives in agencyStats.ts (no components) to avoid a circular import
// between this file and AgencyProfile. Re-export the types for existing consumers.
import { ratingsFor, ovrOf, STAT_LABELS, type Analytics, type Stats, type StatInput } from "./agencyStats";
export { ratingsFor, ovrOf, STAT_LABELS };
export type { Analytics, Stats, StatInput };

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

.agc-card { position:relative; border-radius:16px; padding:2px; animation: agc-in .3s ease both; cursor:pointer;
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
.agc-statwrap { display:flex; align-items:center; gap:10px; margin-top:12px; padding-top:11px; border-top:1px solid rgb(255 255 255 / .1); }
.agc-stats { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
.agc-stat { display:flex; align-items:center; gap:7px; }
.agc-stat b { font-size:12px; color:#e6f2f4; width:20px; text-align:right; font-variant-numeric:tabular-nums; }
.agc-stat span { font-size:9px; letter-spacing:.1em; color: var(--text-soft); }
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

/* Agent dossier modal (Arena card click) */
.agc-modal { position:fixed; inset:0; z-index:420; background: rgb(2 6 10 / .74); backdrop-filter: blur(5px); display:flex; align-items:center; justify-content:center; padding:24px; }
.agc-sheet { position:relative; width:720px; max-width:95vw; max-height:90vh; overflow-y:auto; border-radius:18px; padding:22px 24px 24px; font-family:var(--font-mono);
  border:1px solid rgb(var(--primary) / .4); background: rgb(8 14 20 / .98); box-shadow:0 30px 90px -20px rgb(0 0 0 / .85); }
.agc-x { position:absolute; top:14px; right:14px; width:30px; height:30px; border:1px solid var(--border); background:none; color:var(--text-soft); border-radius:8px; cursor:pointer; z-index:2; }
.agc-x:hover { color:#fff; border-color: rgb(var(--primary) / .6); }
.agc-dhero { display:flex; gap:18px; align-items:flex-start; margin-bottom:12px; padding-right:34px; }
.agc-dphoto { width:96px; height:96px; border-radius:14px; object-fit:cover; border:2px solid var(--tier-b); box-shadow:0 0 22px -6px var(--tier-b); background:#05090d; flex-shrink:0; }
.agc-dphoto.ph { display:flex; align-items:center; justify-content:center; font-size:42px; color: rgb(var(--primary-soft) / .5); }
.agc-dchip { font-size:10px; letter-spacing:.14em; padding:3px 10px; border-radius:999px; border:1px solid rgb(224 162 74 / .5); color:#e0a24a; }
.agc-dchip.alt { border-color: rgb(var(--primary) / .5); color: rgb(var(--primary-soft)); }
.agc-dovr { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:6px 14px; border-radius:14px; border:1px solid var(--tier-b); background: rgb(var(--primary) / .06); flex-shrink:0; }
.agc-dovr b { font-family:var(--font-display); font-size:40px; line-height:.9; color: var(--tier-a); text-shadow:0 0 14px var(--tier-b); }
.agc-dovr span { font-size:8.5px; letter-spacing:.22em; color: var(--text-soft); }
.agc-dgrid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }
@media (max-width:640px){ .agc-dgrid { grid-template-columns:1fr; } }
.agc-dpanel { border:1px solid var(--border); border-radius:14px; padding:14px 16px; background: rgb(var(--primary) / .03); min-width:0; }
.agc-dlabel { font-size:9px; letter-spacing:.22em; color: rgb(var(--primary-soft)); margin-bottom:8px; display:block; }
.agc-dradarnums { display:flex; flex-wrap:wrap; gap:8px 14px; justify-content:center; margin-top:8px; font-size:10px; color:var(--text-soft); }
.agc-dradarnums b { color:#e6f2f4; }
`;

const MEDAL = ["linear-gradient(180deg,#ffe08a,#e0a24a)", "linear-gradient(180deg,#e6eef2,#9fb0bc)", "linear-gradient(180deg,#e0a878,#b5794a)"];

function StatRow({ label, val }: { label: string; val: number }) {
  return <div className="agc-stat"><b>{val}</b><span>{label}</span></div>;
}

const RADAR_KEYS: Array<keyof Stats> = ["DEL", "COD", "CON", "WRK", "THR"];
function polar2(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
/** Compact per-card radar of the five sub-ratings (inherits the card's tier colours). */
function MiniRadar({ s }: { s: Stats }) {
  const S = 108, cx = S / 2, cy = S / 2, R = 42, n = 5;
  const shape = RADAR_KEYS.map((k, i) => polar2(cx, cy, R * (s[k] / 99), i, n).join(",")).join(" ");
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ flexShrink: 0 }}>
      {[0.5, 1].map((rr, ri) => (
        <polygon key={ri} points={RADAR_KEYS.map((_, i) => polar2(cx, cy, R * rr, i, n).join(",")).join(" ")} fill="none" stroke="rgb(255 255 255 / 0.13)" strokeWidth={1} />
      ))}
      {RADAR_KEYS.map((_, i) => { const [x, y] = polar2(cx, cy, R, i, n); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgb(255 255 255 / 0.1)" strokeWidth={1} />; })}
      <polygon points={shape} fill="var(--tier-b)" fillOpacity={0.4} stroke="var(--tier-a)" strokeWidth={1.5} />
    </svg>
  );
}

/** Full-dossier modal for any agent, opened from an Arena card. */
function AgentDossierModal({ a, input, onClose }: { a: Analytics; input: StatInput; onClose: () => void }) {
  const [dossier, setDossier] = useState<AgencyAgentDossier | null>(null);
  useEffect(() => { window.cowork.agencyAgent(a.accountId).then(setDossier).catch(() => setDossier(null)); }, [a.accountId]);
  const gh = dossier?.github;
  const jira = dossier?.jira;
  // Prefer freshly-fetched dossier numbers; fall back to the leaderboard's input.
  const live: StatInput = {
    done: jira?.completed ?? input.done,
    jiraTotal: jira?.total ?? input.jiraTotal,
    ghContrib: gh?.found ? gh.contribTotal : input.ghContrib,
    ghActiveDays: gh?.found ? gh.days.filter((d) => d.count > 0).length : input.ghActiveDays,
    tokensOut: input.tokensOut,
  };
  const s = ratingsFor(live);
  const ovr = ovrOf(s);
  const tier = tierOf(ovr);
  const rk = findRank(a.level);
  const acc = dossier?.account;
  return (
    <div className="agc-modal" onClick={onClose}>
      <div className="agc-sheet" onClick={(e) => e.stopPropagation()} style={{ "--tier-a": tier.a, "--tier-b": tier.b } as React.CSSProperties}>
        <button className="agc-x" onClick={onClose}>✕</button>
        <div className="agc-dhero">
          {a.photo ? <img className="agc-dphoto" src={a.photo} alt="" /> : <div className="agc-dphoto ph">◍</div>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.3em", color: "rgb(var(--primary-soft))" }}>SPECIAL AGENT</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#e6f2f4", lineHeight: 1.05 }}>{a.displayName || a.username}</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>@{a.username}</div>
            {rk?.insignia && <div style={{ fontSize: 13, letterSpacing: "0.24em", color: "#ffd166", marginTop: 4 }}>{rk.insignia}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span className="agc-dchip">★ {a.level || rk?.name || "—"}</span>
              {a.division && <span className="agc-dchip alt">◈ {a.division}</span>}
              {acc?.github && <span className="agc-dchip alt">⌥ {acc.github}</span>}
              {acc?.jira && <span className="agc-dchip alt">◇ {acc.jira}</span>}
            </div>
          </div>
          <div className="agc-dovr"><b>{ovr}</b><span>OVR</span><span className="agc-tier">{tier.name}</span></div>
        </div>
        {acc?.bio && <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.6, margin: "0 2px 12px" }}>{acc.bio}</div>}
        <Tiles items={[
          { label: "OVERALL", value: String(ovr) },
          { label: "JIRA DONE", value: String(live.done), hint: `${live.jiraTotal} assigned` },
          { label: "GH CONTRIB", value: gh?.found ? gh.contribTotal.toLocaleString() : "—", hint: gh?.found ? `${live.ghActiveDays} active days` : undefined },
          { label: "TOKENS", value: fmtK(a.tokensInput + a.tokensOutput) },
          { label: "TIME", value: fmtDur(a.timeSpentMs) },
          { label: "SESSIONS", value: String(a.sessions) },
        ]} />
        <div className="agc-dgrid">
          <div className="agc-dpanel" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="mono agc-dlabel">CHARACTERISTICS</div>
            <MiniRadar s={s} />
            <div className="agc-dradarnums">
              {STAT_LABELS.map(({ key, short }) => <span key={key}>{short} <b>{s[key]}</b></span>)}
            </div>
          </div>
          <div className="agc-dpanel">
            <div className="mono agc-dlabel">JIRA WORKLOAD</div>
            {jira && jira.total > 0 ? <Bars rows={[
              { label: "TO DO", value: jira.todo, color: "var(--text-faint)" },
              { label: "IN PROG", value: jira.inProgress, color: "rgb(var(--accent))" },
              { label: "DONE", value: jira.completed, color: "#5ef2b0" },
            ]} /> : <div className="soft" style={{ fontSize: 11.5 }}>No Jira workload.</div>}
          </div>
        </div>
        <div className="agc-dpanel" style={{ marginTop: 12 }}>
          {gh?.found ? <GithubHeatmap days={gh.days} total={gh.contribTotal} /> : <div className="soft" style={{ fontSize: 11.5 }}>{acc?.github ? "No public GitHub activity found." : "No GitHub linked."}</div>}
        </div>
      </div>
    </div>
  );
}

function PlayerCard({ a, rank, input, onOpen }: { a: Analytics; rank: number; input: StatInput; onOpen: () => void }) {
  const s = ratingsFor(input);
  const ovr = ovrOf(s);
  const tier = tierOf(ovr);
  const rk = findRank(a.level);
  const style = { "--tier-a": tier.a, "--tier-b": tier.b, "--tier-text": tier.text } as React.CSSProperties;
  return (
    <div className="agc-card" style={style} onClick={onOpen} role="button" title="View full dossier">
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
        <div className="agc-statwrap">
          <MiniRadar s={s} />
          <div className="agc-stats">
            {STAT_LABELS.map(({ key, short }) => <StatRow key={key} label={short} val={s[key]} />)}
          </div>
        </div>
        <div className="agc-real">
          <span><b>{input.ghContrib.toLocaleString()}</b> contrib</span>
          <span><b>{input.done}</b> done</span>
          <span><b>{fmtK(a.tokensInput + a.tokensOutput)}</b> tok</span>
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
  const [tab, setTab] = useState<"profile" | "arena" | "chat" | "dms">("profile");
  const [rows, setRows] = useState<Analytics[] | null>(null);
  const [err, setErr] = useState("");
  const [meUsername, setMeUsername] = useState<string | null>(null);
  const [jiraByAccount, setJiraByAccount] = useState<Record<string, { completed: number; total: number }>>({});
  const [ghByAccount, setGhByAccount] = useState<Record<string, { contribTotal: number; activeDays: number }>>({});
  const [openAgent, setOpenAgent] = useState<Analytics | null>(null);

  const inputFor = (a: Analytics): StatInput => ({
    done: jiraByAccount[a.accountId]?.completed ?? 0,
    jiraTotal: jiraByAccount[a.accountId]?.total ?? 0,
    ghContrib: ghByAccount[a.accountId]?.contribTotal ?? 0,
    ghActiveDays: ghByAccount[a.accountId]?.activeDays ?? 0,
    tokensOut: a.tokensOutput,
  });

  useEffect(() => {
    window.cowork.accountsMe().then((m) => {
      setMeUsername(m && "username" in m ? (m.username as string | null) : null);
    }).catch(() => {});
  }, []);

  // Real signals — Jira (completed + total) and GitHub (contributions + active days) per
  // agent, both cached server-side. These, not tokens, drive the ranking.
  useEffect(() => {
    let alive = true;
    const load = () => {
      window.cowork.agencyJiraStats()
        .then((stats) => { if (alive) setJiraByAccount(Object.fromEntries(stats.map((s) => [s.accountId, { completed: s.completed, total: s.total }]))); })
        .catch(() => {});
      window.cowork.agencyGithubRoster()
        .then((rows) => { if (alive) setGhByAccount(Object.fromEntries(rows.map((r) => [r.accountId, { contribTotal: r.contribTotal, activeDays: r.activeDays }]))); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 120000);
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
    const list = (rows ?? []).map((a) => ({ a, ovr: ovrOf(ratingsFor(inputFor(a))) }));
    return list.sort((x, y) => y.ovr - x.ovr).map((x) => x.a);
  }, [rows, jiraByAccount, ghByAccount]); // eslint-disable-line

  return (
    <div className="agc-root">
      <style>{CSS}</style>
      <div className="agc-tabs">
        <button className={`agc-tab${tab === "profile" ? " on" : ""}`} onClick={() => setTab("profile")}>◆ DOSSIER</button>
        <button className={`agc-tab${tab === "arena" ? " on" : ""}`} onClick={() => setTab("arena")}>⬡ ARENA</button>
        <button className={`agc-tab${tab === "chat" ? " on" : ""}`} onClick={() => setTab("chat")}>◈ IRC CHAT</button>
        <button className="agc-tab soon" title="Coming soon">✉ DMs</button>
      </div>
      {tab === "profile" && <AgencyProfile />}
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
              {ranked.map((a, i) => <PlayerCard key={a.accountId} a={a} rank={i + 1} input={inputFor(a)} onOpen={() => setOpenAgent(a)} />)}
            </div>
          )}
          {openAgent && <AgentDossierModal a={openAgent} input={inputFor(openAgent)} onClose={() => setOpenAgent(null)} />}
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
