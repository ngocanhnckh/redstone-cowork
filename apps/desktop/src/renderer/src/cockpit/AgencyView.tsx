import { useEffect, useMemo, useRef, useState } from "react";
import { findRank } from "./ranks";
import type { AgencyMessage, AgencyGithubDay } from "../../../shared/agency";
import AgencyProfile from "./AgencyProfile";
import AgentIdentScan from "./AgentIdentScan";
import AgentWeek from "./AgentWeek";
import { Tiles, Bars, GithubHeatmap } from "./agencyCharts";
import { IconComment, IconExternal, IconCrown, IconGlobe, IconKey, IconCheckCircle, IconContainer, IconMonitor } from "./Icons";
import RankInsignia from "./RankInsignia";
import { AgentDmPanel } from "./AgencyDm";
import { IconTrophy } from "./Icons";
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
  if (ovr >= 88) return { name: "ELITE", a: "#f2f0eb", b: "#c9c6bf", text: "#1a1917" };
  if (ovr >= 75) return { name: "VETERAN", a: "#d6d4cf", b: "#a8a59e", text: "#1a1917" };
  if (ovr >= 55) return { name: "OPERATIVE", a: "#a8a59e", b: "#7a776f", text: "#111013" };
  return { name: "TRAINEE", a: "#8a877f", b: "#5c5952", text: "#f2f0eb" };
}

const CSS = `
@keyframes agc-shine { from { background-position: -160% 0; } to { background-position: 260% 0; } }
@keyframes agc-in { from { opacity:0; transform: translateY(10px) scale(.98); } to { opacity:1; transform:none; } }
.agc-root { height:100%; min-height:0; display:flex; flex-direction:column; font-family:var(--font-mono); }
.agc-tabs { display:flex; gap:6px; padding:12px 16px 0; flex-shrink:0; }
.agc-tab { padding:7px 15px; border-radius:9px 9px 0 0; font-size:11px; font-weight:700; letter-spacing:.2em; cursor:pointer;
  border:1px solid var(--border); border-bottom:none; background:transparent; color:var(--text-soft); }
.agc-tab.on { background: rgba(232,230,225,0.2); color:#fff; border-color: rgba(232,230,225,0.5); }
.agc-tab.soon { opacity:.5; cursor:default; }
.agc-hd { display:flex; align-items:baseline; gap:12px; padding:14px 18px 6px; }
.agc-hd h2 { font-family:var(--font-display); font-size:24px; margin:0; letter-spacing:.02em; color:var(--text); }
.agc-search { padding: 4px 18px 10px; }
.agc-search input { width:100%; box-sizing:border-box; padding:10px 14px; border-radius:11px; font-size:13px; font-family:inherit;
  border:1px solid var(--border); background: rgba(232,230,225,0.05); color: var(--text); outline:none; }
.agc-search input:focus { border-color: rgba(232,230,225,0.6); box-shadow: 0 0 0 1px rgba(232,230,225,0.25); }

/* Vertical stack: each entry = the compact card (grid size) + an info panel to its right */
.agc-list { flex:1; min-height:0; overflow-y:auto; padding:6px 18px 26px; display:flex; flex-direction:column; gap:14px; }
.agc-entry { display:flex; gap:14px; align-items:stretch; cursor:pointer; animation: agc-in .26s ease both;
  background: color-mix(in srgb, var(--app-panel) 55%, transparent);
  -webkit-backdrop-filter: blur(var(--app-blur, 6px)); backdrop-filter: blur(var(--app-blur, 6px));
  border: 1px solid var(--border); padding: 4px; }

/* --- the compact card (identical size to grid mode: ~236px) --- */
.agc-card { position:relative; width:236px; flex-shrink:0; border-radius:16px; padding:2px;
  background: linear-gradient(160deg, var(--tier-a), var(--tier-b)); box-shadow: 0 16px 40px -16px rgb(0 0 0 / .7); }
.agc-entry:hover { border-color: var(--border-strong); }
.agc-inner { position:relative; overflow:hidden; border-radius:14px; padding:14px 14px 15px;
  background: linear-gradient(180deg, rgb(6 12 20 / .93), rgb(8 16 26 / .97)); }
.agc-inner::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background: linear-gradient(115deg, transparent 36%, rgb(255 255 255 / .14) 50%, transparent 64%); background-size: 220% 100%; animation: agc-shine 5s ease-in-out infinite; }
.agc-top { display:flex; gap:12px; }
.agc-ovr { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:52px; }
.agc-ovr b { font-family:var(--font-display); font-size:34px; line-height:.9; color: var(--tier-a); text-shadow: 0 0 14px var(--tier-b); }
.agc-ovr span { font-size:8px; letter-spacing:.22em; color: var(--text-soft); margin-top:2px; }
.agc-tier { display:inline-block; margin-top:6px; font-size:8px; font-weight:800; letter-spacing:.18em; padding:2px 7px; border-radius:5px;
  background: linear-gradient(180deg, var(--tier-a), var(--tier-b)); color: var(--tier-text); }
.agc-photo { width:60px; height:60px; border-radius:12px; object-fit:cover; border:1.5px solid var(--tier-b); box-shadow:0 0 18px -5px var(--tier-b); background:#05090d; margin-left:auto; }
.agc-photo.ph { display:flex; align-items:center; justify-content:center; font-size:26px; color: rgb(255 255 255 / .35); }
.agc-name { font-size:14px; font-weight:700; letter-spacing:.03em; color:var(--text); margin-top:11px; line-height:1.15; }
.agc-sub { font-size:9.5px; letter-spacing:.1em; color: var(--text-faint); margin-top:2px; }
.agc-insignia { font-size:11px; letter-spacing:.24em; color:var(--text-soft); margin-top:4px; min-height:12px; }
.agc-statwrap { display:flex; align-items:center; gap:10px; margin-top:12px; padding-top:11px; border-top:1px solid rgb(255 255 255 / .1); }
.agc-stats { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
.agc-stat { display:flex; align-items:center; gap:7px; }
.agc-stat b { font-size:12px; color:var(--text); width:20px; text-align:right; font-variant-numeric:tabular-nums; }
.agc-stat span { font-size:9px; letter-spacing:.1em; color: var(--text-soft); }
.agc-rankbadge { position:absolute; top:-9px; left:-9px; z-index:3; width:30px; height:30px; border-radius:50%;
  display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; font-family:var(--font-display);
  border:2px solid #06121a; box-shadow:0 4px 14px rgb(0 0 0 / .6); }

/* --- the info panel to the right --- */
.agc-side { flex:1; min-width:0; display:flex; flex-direction:column; gap:12px; padding:15px 18px; border-radius:14px;
  border:1px solid var(--border); background: rgb(var(--primary) / .035); transition: border-color .14s, background .14s; }
.agc-entry:hover .agc-side { border-color: rgb(var(--primary) / .4); background: rgb(var(--primary) / .06); }
.agc-side-top { display:flex; align-items:center; gap:14px; }
.agc-side-rank { font-family:var(--font-display); font-size:38px; font-weight:700; line-height:1; display:flex; align-items:baseline; }
.agc-side-hash { font-size:17px; opacity:.55; margin-right:1px; }
.agc-metrics { display:grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap:10px; }
.agc-metric { border:1px solid var(--border); border-radius:11px; padding:9px 12px; background: rgb(var(--primary) / .04); }
.agc-metric-v { font-family:var(--font-display); font-size:22px; line-height:1; color:var(--text); }
.agc-metric-l { font-size:8.5px; letter-spacing:.16em; color: rgb(var(--primary-soft)); margin-top:6px; }
.agc-metric-h { font-size:9px; color: var(--text-faint); margin-top:2px; }
.agc-side-foot { margin-top:auto; font-size:10px; letter-spacing:.04em; color: var(--text-faint); }
@media (max-width: 720px) { .agc-entry { flex-direction:column; } .agc-card { width:100%; } }

/* IRC chat */
.agx-chat { flex:1; min-height:0; display:flex; flex-direction:column; padding:0 18px 14px; }
.agx-log { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:2px; padding:8px 2px; font-size:13px; }
.agx-line { display:flex; gap:8px; padding:3px 8px; border-radius:7px; align-items:baseline; }
.agx-line:hover { background: rgba(232,230,225,0.06); }
.agx-ts { font-size:9.5px; color: var(--text-faint); font-variant-numeric:tabular-nums; flex-shrink:0; width:42px; }
.agx-who { font-weight:700; color: rgb(var(--primary-soft)); flex-shrink:0; }
.agx-who.me { color: rgb(var(--accent)); }
.agx-body { color: var(--text); word-break:break-word; min-width:0; }
.agx-compose { display:flex; gap:8px; margin-top:8px; }
.agx-input { flex:1; padding:11px 14px; border-radius:10px; font-size:13px; font-family:inherit;
  border:1px solid rgba(232,230,225,0.3); background: rgba(232,230,225,0.05); color: var(--text); outline:none; }
.agx-input:focus { border-color: rgba(232,230,225,0.7); }
.agx-send { padding:0 18px; border-radius:10px; border:1px solid rgba(232,230,225,0.6); cursor:pointer;
  background: rgba(232,230,225,0.2); color:var(--text); font-family:inherit; font-size:12px; font-weight:700; letter-spacing:.18em; }
.agx-send:disabled { opacity:.4; cursor:not-allowed; }

/* Agent dossier modal (Arena card click) */
.agc-modal { position:fixed; inset:0; z-index:420; background: rgb(2 6 10 / .74); backdrop-filter: blur(5px); display:flex; align-items:center; justify-content:center; padding:24px; }
.agc-sheet { position:relative; width:1040px; max-width:95vw; max-height:92vh; overflow-y:auto; border-radius:18px; padding:22px 24px 24px; font-family:var(--font-mono);
  border:1px solid rgb(var(--primary) / .4); background: rgb(8 14 20 / .98); box-shadow:0 30px 90px -20px rgb(0 0 0 / .85); }
.agc-x { position:absolute; top:14px; right:14px; width:30px; height:30px; border:1px solid var(--border); background:none; color:var(--text-soft); border-radius:8px; cursor:pointer; z-index:2; }
.agc-x:hover { color:#fff; border-color: rgb(var(--primary) / .6); }
.agc-dhero { display:flex; gap:18px; align-items:flex-start; margin-bottom:12px; padding-right:34px; }
/* dossier split: portrait column left, all measurable info right */
.agc-dsplit { display:grid; grid-template-columns: 300px 1fr; gap:18px; align-items:start; padding-right:30px; }
@media (max-width:900px){ .agc-dsplit { grid-template-columns:1fr; } }
.agc-dleft { min-width:0; }
.agc-dright { min-width:0; }
.agc-dovrbar { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; margin-top:14px;
  border-top:1px solid var(--border); border-bottom:1px solid var(--border); padding:10px 0; }
.agc-dovrnum { font-family:var(--font-display); font-weight:700; font-size:34px; line-height:.95; color:var(--text); font-variant-numeric:tabular-nums; }
.agc-dovrlbl { font-size:8px; letter-spacing:.2em; color:var(--text-faint); margin-top:3px; }
.agc-dphoto { width:100%; height:300px; object-fit:cover; border:1px solid var(--border-strong); background:#05090d; flex-shrink:0; display:block; }
.agc-dphotowrap { position:relative; width:100%; flex-shrink:0; animation: agc-reveal .5s cubic-bezier(.2,.9,.3,1) both; }
@keyframes agc-reveal { 0% { clip-path: inset(49% 0 49% 0); opacity:0; } 45% { opacity:1; } 100% { clip-path: inset(0 0 0 0); opacity:1; } }
.agc-dphotowrap .rt { position:absolute; width:16px; height:16px; border-color:#e63b2e; pointer-events:none; }
.agc-dphotowrap .rt.tl { top:-1px; left:-1px; border-top:1px solid; border-left:1px solid; }
.agc-dphotowrap .rt.tr { top:-1px; right:-1px; border-top:1px solid; border-right:1px solid; }
.agc-dphotowrap .rt.bl { bottom:-1px; left:-1px; border-bottom:1px solid; border-left:1px solid; }
.agc-dphotowrap .rt.br { bottom:-1px; right:-1px; border-bottom:1px solid; border-right:1px solid; }
.agc-dphotowrap .idtag { position:absolute; left:0; bottom:0; right:0; padding:5px 9px; font-size:8px; letter-spacing:.22em;
  background:rgb(10 10 10 / .82); color:var(--text-soft); display:flex; justify-content:space-between; }
.agc-dphotowrap .idtag b { color:#e63b2e; font-weight:400; }
/* staggered panel entrance */
.agc-stg { animation: agc-rise .34s cubic-bezier(.2,.9,.3,1) both; }
@keyframes agc-rise { from { opacity:0; transform:translateY(9px); } }
@keyframes agc-grow { from { transform: scaleY(0); } }
@keyframes agc-radar { from { transform: scale(.2); opacity:0; } }
.agc-dphoto.ph { display:flex; align-items:center; justify-content:center; font-size:64px; color: rgb(var(--primary-soft) / .5); }
.agc-dchip { font-size:10px; letter-spacing:.14em; padding:3px 10px; border-radius:999px; border:1px solid rgb(232 230 225 / .5); color:var(--text-soft); }
.agc-dchip.alt { border-color: rgb(var(--primary) / .5); color: rgb(var(--primary-soft)); }
.agc-dlink { display:flex; justify-content:flex-start; align-items:center; gap:6px; font-family:var(--font-mono); font-size:10px; letter-spacing:.1em;
  padding:3px 9px; border:1px solid var(--border); background:transparent; color:var(--text-soft); cursor:pointer; }
.agc-dlink:hover { border-color:#e63b2e; color:var(--text); }
.agc-dlink-go { color:var(--text-faint); font-size:9px; }
/* stat tiles (Tiles from agencyCharts) — AgencyProfile owns an identical block, but
   it isn't mounted on the Arena tab, so the dossier carries its own. */
.agc-sheet .agp-tiles { display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-top:0; }
.agc-sheet .agp-tile { border:1px solid var(--border); padding:9px 11px; background: rgba(232,230,225,.02); min-width:0; }
.agc-sheet .agp-tile-v { font-family:var(--font-display); font-weight:700; font-size:20px; line-height:1; color:var(--text); font-variant-numeric:tabular-nums; }
.agc-sheet .agp-tile-l { font-size:8px; letter-spacing:.18em; color:var(--text-faint); margin-top:5px; text-transform:uppercase; }
.agc-sheet .agp-tile-h { font-size:8.5px; color:var(--text-soft); margin-top:3px; }
.agc-dlink:hover .agc-dlink-go { color:#e63b2e; }
.agc-dovr { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:6px 14px; border-radius:14px; border:1px solid var(--tier-b); background: rgb(var(--primary) / .06); flex-shrink:0; }
.agc-dovr b { font-family:var(--font-display); font-size:40px; line-height:.9; color: var(--tier-a); text-shadow:0 0 14px var(--tier-b); }
.agc-dovr span { font-size:8.5px; letter-spacing:.22em; color: var(--text-soft); }
.agc-dgrid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }
@media (max-width:640px){ .agc-dgrid { grid-template-columns:1fr; } }
.agc-dpanel { border:1px solid var(--border); border-radius:14px; padding:14px 16px; background: rgb(var(--primary) / .03); min-width:0; }
.agc-dlabel { font-size:9px; letter-spacing:.22em; color: rgb(var(--primary-soft)); margin-bottom:8px; display:block; }
.agc-dradarnums { display:flex; flex-wrap:wrap; gap:8px 14px; justify-content:center; margin-top:8px; font-size:10px; color:var(--text-soft); }
.agc-dradarnums b { color:var(--text); }
`;


const RADAR_KEYS: Array<keyof Stats> = ["DEL", "COD", "CON", "WRK", "THR"];
function polar2(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
/** Compact per-card radar of the five sub-ratings (inherits the card's tier colours). */
function MiniRadar({ s, size = 108, labelled = false }: { s: Stats; size?: number; labelled?: boolean }) {
  const S = size, cx = S / 2, cy = S / 2, R = S * (labelled ? 0.31 : 0.39), n = 5;
  const shape = RADAR_KEYS.map((k, i) => polar2(cx, cy, R * (s[k] / 99), i, n).join(",")).join(" ");
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ flexShrink: 0, overflow: "visible" }}>
      {[0.25, 0.5, 0.75, 1].map((rr, ri) => (
        <polygon key={ri} points={RADAR_KEYS.map((_, i) => polar2(cx, cy, R * rr, i, n).join(",")).join(" ")}
          fill="none" stroke="rgba(232,230,225,0.11)" strokeWidth={1} />
      ))}
      {RADAR_KEYS.map((_, i) => { const [x, y] = polar2(cx, cy, R, i, n); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(232,230,225,0.09)" strokeWidth={1} />; })}
      <polygon points={shape} fill="#e63b2e" fillOpacity={0.16} stroke="#e63b2e" strokeWidth={1.6}
        style={{ animation: "agc-radar .55s cubic-bezier(.2,.9,.3,1) both", transformOrigin: `${cx}px ${cy}px` }} />
      {RADAR_KEYS.map((k, i) => {
        const [px, py] = polar2(cx, cy, R * (s[k] / 99), i, n);
        return <rect key={`p${i}`} x={px - 2} y={py - 2} width={4} height={4} fill="#e63b2e" />;
      })}
      {labelled && STAT_LABELS.map(({ key, long }, i) => {
        const [lx, ly] = polar2(cx, cy, R + S * 0.155, i, n);
        const anchor = Math.abs(lx - cx) < 3 ? "middle" : lx > cx ? "start" : "end";
        return (
          <g key={`l${key}`}>
            <text x={lx} y={ly - 2} textAnchor={anchor}
              style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.14em", fill: "var(--text-faint)" }}>{long}</text>
            <text x={lx} y={ly + 10} textAnchor={anchor}
              style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12, fill: "var(--text)" }}>{s[key]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Numbers tick up to their value when the dossier opens (data movement, not decoration). */
function useCountUp(target: number, ms = 750): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => {
      const f = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - f, 3))));
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Last-7-days contribution bars — real per-day GitHub counts, newest right. */
function SevenDay({ days }: { days: AgencyGithubDay[] }) {
  const last = days.slice(-7);
  const max = Math.max(1, ...last.map((d) => d.count));
  const total = last.reduce((a, d) => a + d.count, 0);
  const shown = useCountUp(total);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="mono agc-dlabel" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}><IconGlobe size={11} />CONTRIBUTIONS · LAST 7 DAYS</span>
        <span className="mono" style={{ fontSize: 15, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{shown}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 74 }}>
        {last.map((d, i) => {
          const h = Math.max(2, (d.count / max) * 66);
          const dt = new Date(d.date + "T00:00:00");
          const today = i === last.length - 1;
          return (
            <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
              <span className="mono" style={{ fontSize: 8.5, color: d.count ? "var(--text-soft)" : "var(--text-faint)" }}>{d.count}</span>
              <span title={`${d.date} · ${d.count}`} style={{
                width: "100%", height: h, background: today ? "#e63b2e" : "rgba(232,230,225,.34)",
                animation: `agc-grow .5s cubic-bezier(.2,.9,.3,1) ${i * 55}ms both`, transformOrigin: "bottom",
              }} />
              <span className="mono" style={{ fontSize: 7.5, letterSpacing: ".1em", color: "var(--text-faint)" }}>
                {dt.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase().slice(0, 2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Jira completion ring — done vs the rest of the assigned workload. */
function MissionRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const shown = useCountUp(pct);
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: 84, height: 84, flexShrink: 0 }}>
        <svg width={84} height={84} viewBox="0 0 84 84">
          <circle cx={42} cy={42} r={R} fill="none" stroke="rgba(232,230,225,.12)" strokeWidth={3} />
          <circle cx={42} cy={42} r={R} fill="none" stroke="#e8e6e1" strokeWidth={3}
            strokeDasharray={C} strokeDashoffset={C - (C * shown) / 100} transform="rotate(-90 42 42)"
            style={{ transition: "stroke-dashoffset .1s linear" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div>
            <div className="mono" style={{ fontSize: 15, color: "var(--text)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{shown}%</div>
            <div className="mono" style={{ fontSize: 7, letterSpacing: ".16em", color: "var(--text-faint)", marginTop: 2 }}>DONE</div>
          </div>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 20, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{done}</div>
        <div className="mono" style={{ fontSize: 8, letterSpacing: ".16em", color: "var(--text-faint)" }}>MISSIONS CLOSED</div>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-soft)", marginTop: 6 }}>{total} assigned</div>
      </div>
    </div>
  );
}

/** External profile links (GitHub / Jira / Mattermost) — open in the real browser.
 *  Jira's host comes from the bound Jira profile; Mattermost's from a configured
 *  custom app whose URL looks like a Mattermost server. */
function ProfileLinks({ acc }: { acc: AgencyAgentDossier["account"] | undefined }) {
  const [jiraBase, setJiraBase] = useState<string | null>(null);
  const [mmBase, setMmBase] = useState<string | null>(null);
  useEffect(() => {
    window.cowork.jiraProfilesList()
      .then((ps) => setJiraBase(ps?.[0]?.baseUrl?.replace(/\/+$/, "") ?? null))
      .catch(() => setJiraBase(null));
    // Mattermost host comes from the user's configured custom apps (same list the
    // HUD dock reads); no separate setting to keep in sync.
    try {
      const raw = localStorage.getItem("rcw.customApps");
      const apps: Array<{ name?: string; url?: string }> = raw ? JSON.parse(raw) : [];
      const mm = Array.isArray(apps)
        ? apps.find((x) => typeof x?.url === "string" && (/mattermost/i.test(x.url) || /mattermost/i.test(x.name ?? "")))
        : null;
      setMmBase(mm?.url ? mm.url.replace(/\/+$/, "") : null);
    } catch { setMmBase(null); }
  }, []);
  if (!acc) return null;
  const open = (url: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    window.cowork.openExternal(url).catch(() => {});
  };
  const links: Array<{ key: string; label: string; url: string; icon: React.ReactNode }> = [];
  if (acc.github) links.push({ key: "gh", label: `GitHub · ${acc.github}`, url: `https://github.com/${encodeURIComponent(acc.github)}`, icon: <IconExternal size={11} /> });
  if (acc.jira && jiraBase) links.push({ key: "jira", label: `Jira · ${acc.jira}`, url: `${jiraBase}/secure/ViewProfile.jspa?name=${encodeURIComponent(acc.jira)}`, icon: <IconExternal size={11} /> });
  if (acc.mattermost && mmBase) links.push({ key: "mm", label: `Mattermost · ${acc.mattermost}`, url: `${mmBase}/_redirect/messages/@${encodeURIComponent(acc.mattermost)}`, icon: <IconComment size={11} /> });
  if (!links.length) return null;
  return (
    <>
      {links.map((l) => (
        <button key={l.key} className="agc-dlink" onClick={open(l.url)} title={l.url}>
          {l.icon}<span>{l.label}</span><span className="agc-dlink-go">↗</span>
        </button>
      ))}
    </>
  );
}

/** Full-dossier modal for any agent, opened from an Arena card. */
function AgentDossierModal({ a, input, meUsername, onClose }: { a: Analytics; input: StatInput; meUsername: string | null; onClose: () => void }) {
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
        <div className="agc-dsplit">
          {/* ── LEFT: the portrait column ── */}
          <aside className="agc-dleft">
            <div className="agc-dphotowrap">
              {a.photo ? <img className="agc-dphoto" src={a.photo} alt="" /> : <div className="agc-dphoto ph">◍</div>}
              <span className="rt tl" /><span className="rt tr" /><span className="rt bl" /><span className="rt br" />
              <span className="idtag"><span>ID {a.accountId.slice(0, 8).toUpperCase()}</span><b>VERIFIED</b></span>
            </div>
            <div className="mono" style={{ fontSize: 9, letterSpacing: "0.3em", color: "#e63b2e", display: "flex", alignItems: "center", gap: 6, marginTop: 14 }}>
              <IconKey size={10} />SPECIAL AGENT
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 25, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text)", lineHeight: 1.1, marginTop: 4 }}>
              {a.displayName || a.username}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>@{a.username}</div>
            {rk && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, color: rk.tier === "general" ? "#e8e6e1" : "var(--text-soft)" }}>
                <RankInsignia rank={rk.name} size={14} />
                <span className="mono" style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-faint)" }}>{rk.name}</span>
              </div>
            )}
            <div className="agc-dovrbar">
              <div><div className="agc-dovrnum">{ovr}</div><div className="mono agc-dovrlbl">OVERALL</div></div>
              <div style={{ textAlign: "right" }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--text)" }}>{tier.name}</div>
                <div className="mono agc-dovrlbl">TIER</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
              <span className="agc-dchip" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconCrown size={10} />{a.level || rk?.name || "—"}</span>
              {a.division && <span className="agc-dchip alt" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconContainer size={10} />{a.division}</span>}
            </div>
            <div className="mono agc-dlabel" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16 }}><IconExternal size={10} />PROFILES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><ProfileLinks acc={acc} /></div>
            {acc?.bio && <div style={{ fontSize: 11.5, color: "var(--text-soft)", lineHeight: 1.6, marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>{acc.bio}</div>}
          </aside>

          {/* ── RIGHT: everything measurable ── */}
          <div className="agc-dright">
            <Tiles items={[
              { label: "OVERALL", value: String(ovr) },
              { label: "JIRA DONE", value: String(live.done), hint: `${live.jiraTotal} assigned` },
              { label: "GH CONTRIB", value: gh?.found ? gh.contribTotal.toLocaleString() : "—", hint: gh?.found ? `${live.ghActiveDays} active days` : undefined },
              { label: "TOKENS", value: fmtK(a.tokensInput + a.tokensOutput) },
              { label: "TIME", value: fmtDur(a.timeSpentMs) },
              { label: "SESSIONS", value: String(a.sessions) },
            ]} />
            <div className="agc-dgrid" style={{ marginTop: 12 }}>
              <div className="agc-dpanel agc-stg" style={{ animationDelay: "40ms", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div className="mono agc-dlabel" style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                  <IconMonitor size={11} />CHARACTERISTICS
                </div>
                <MiniRadar s={s} size={236} labelled />
              </div>
              <div className="agc-dpanel agc-stg" style={{ animationDelay: "90ms" }}>
                <div className="mono agc-dlabel" style={{ display: "flex", alignItems: "center", gap: 6 }}><IconCheckCircle size={11} />MISSION COMPLETION</div>
                {jira && jira.total > 0 ? (
                  <>
                    <MissionRing done={jira.completed} total={jira.total} />
                    <div style={{ marginTop: 14 }}>
                      <Bars rows={[
                        { label: "TO DO", value: jira.todo, color: "var(--text-faint)" },
                        { label: "IN PROG", value: jira.inProgress, color: "#e63b2e" },
                        { label: "DONE", value: jira.completed, color: "var(--text-soft)" },
                      ]} />
                    </div>
                  </>
                ) : <div className="soft" style={{ fontSize: 11.5 }}>No Jira workload.</div>}
              </div>
            </div>
            <div className="agc-dpanel agc-stg" style={{ marginTop: 12, animationDelay: "140ms" }}>
              {gh?.found ? <SevenDay days={gh.days} /> : <div className="soft" style={{ fontSize: 11.5 }}>{acc?.github ? "No public GitHub activity found." : "No GitHub linked."}</div>}
            </div>
            <div className="agc-dpanel agc-stg" style={{ marginTop: 12, animationDelay: "190ms" }}>
              {gh?.found ? <GithubHeatmap days={gh.days} total={gh.contribTotal} /> : <div className="soft" style={{ fontSize: 11.5 }}>No contribution history.</div>}
            </div>
          </div>
        </div>
        {a.username !== meUsername && (
          <div style={{ marginTop: 12 }}>
            <AgentDmPanel accountId={a.accountId} name={a.displayName || a.username} meUsername={meUsername} />
          </div>
        )}
      </div>
    </div>
  );
}

const MEDAL = ["#e8e6e1", "#b5b2ab", "#8a877f"];
function StatRow({ label, val }: { label: string; val: number }) {
  return <div className="agc-stat"><b>{val}</b><span>{label}</span></div>;
}

/** The original compact player card (grid-mode size) + an info panel to its right,
 *  one entry per row (vertical leaderboard). */
function LeaderEntry({ a, rank, input, onOpen }: { a: Analytics; rank: number; input: StatInput; onOpen: () => void }) {
  const s = ratingsFor(input);
  const ovr = ovrOf(s);
  const tier = tierOf(ovr);
  const rk = findRank(a.level);
  const style = { "--tier-a": tier.a, "--tier-b": tier.b, "--tier-text": tier.text } as React.CSSProperties;
  return (
    <div className="agc-entry" style={style} onClick={onOpen} role="button" title="View full dossier">
      {/* the compact card (same size as grid mode) */}
      <div className="agc-card">
        {rank <= 3 && <div className="agc-rankbadge" style={{ background: MEDAL[rank - 1], color: "#1a1006" }}>{rank}</div>}
        <div className="agc-inner">
          <div className="agc-top">
            <div className="agc-ovr"><b>{ovr}</b><span>OVR</span><span className="agc-tier">{tier.name}</span></div>
            {a.photo ? <img className="agc-photo" src={a.photo} alt={a.displayName} /> : <div className="agc-photo ph">◍</div>}
          </div>
          <div className="agc-name">{a.displayName || a.username}</div>
          <div className="agc-sub">@{a.username}{a.division ? ` · ${a.division}` : ""}</div>
          <div className="agc-insignia">{rk?.insignia ? `${rk.insignia}  ${rk.name}` : rk?.name ?? ""}</div>
          <div className="agc-statwrap">
            <MiniRadar s={s} />
            <div className="agc-stats">{STAT_LABELS.map(({ key, short }) => <StatRow key={key} label={short} val={s[key]} />)}</div>
          </div>
        </div>
      </div>
      {/* info panel to the right */}
      <div className="agc-side">
        <div className="agc-side-top">
          <div className="agc-side-rank" style={{ color: rank <= 3 ? ["var(--text)", "var(--text-soft)", "var(--text-faint)"][rank - 1] : "var(--text-faint)" }}>
            <span className="agc-side-hash">#</span>{rank}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: ".2em", color: "rgb(var(--primary-soft))" }}>OVERALL RATING</div>
            <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{tier.name} agent · {rk?.name ?? "—"}</div>
          </div>
        </div>
        <div className="agc-metrics">
          {[
            { l: "GH CONTRIB", v: input.ghContrib.toLocaleString(), h: "last year" },
            { l: "ACTIVE DAYS", v: String(input.ghActiveDays) },
            { l: "JIRA DONE", v: String(input.done), h: `${input.jiraTotal} assigned` },
            { l: "TOKENS", v: fmtK(a.tokensInput + a.tokensOutput) },
            { l: "TIME", v: fmtDur(a.timeSpentMs) },
            { l: "SESSIONS", v: String(a.sessions), h: `${a.activeSessions} active` },
          ].map((m) => (
            <div className="agc-metric" key={m.l}>
              <div className="agc-metric-v">{m.v}</div>
              <div className="agc-metric-l">{m.l}</div>
              {m.h && <div className="agc-metric-h">{m.h}</div>}
            </div>
          ))}
        </div>
        <div className="agc-side-foot">
          {a.lastActiveAt ? `last active ${new Date(a.lastActiveAt).toLocaleDateString()}` : "no recent activity"} · click for full dossier & DM →
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
  const [tab, setTab] = useState<"profile" | "arena" | "week" | "chat" | "dms">("profile");
  const [meRole, setMeRole] = useState<string | null>(null);
  const [rows, setRows] = useState<Analytics[] | null>(null);
  const [err, setErr] = useState("");
  const [meUsername, setMeUsername] = useState<string | null>(null);
  const [jiraByAccount, setJiraByAccount] = useState<Record<string, { completed: number; total: number }>>({});
  const [ghByAccount, setGhByAccount] = useState<Record<string, { contribTotal: number; activeDays: number }>>({});
  const [openAgent, setOpenAgent] = useState<Analytics | null>(null);
  const [scanning, setScanning] = useState<Analytics | null>(null);
  const [search, setSearch] = useState("");

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
      setMeRole(m && "role" in m ? (m.role as string | null) : null);
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
        <button className={`agc-tab${tab === "week" ? " on" : ""}`} onClick={() => setTab("week")}><IconTrophy size={11} style={{ display: "inline-block", verticalAlign: "-1px", marginRight: 5 }} /> AGENT OF THE WEEK</button>
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
          <div className="agc-search">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents by name, @handle or division…" />
          </div>
          {err && <div style={{ padding: "0 18px 10px", color: "#e63b2e", fontSize: 12 }}>⚠ {err}</div>}
          {rows === null ? (
            <div className="soft" style={{ padding: 24, fontSize: 13 }}>Loading roster…</div>
          ) : ranked.length === 0 ? (
            <div className="soft" style={{ padding: 24, fontSize: 13 }}>No agents on the board yet.</div>
          ) : (() => {
            const q = search.trim().toLowerCase();
            // Rank number reflects the FULL leaderboard position, preserved when filtering.
            const shown = ranked.map((a, i) => ({ a, rank: i + 1 }))
              .filter(({ a }) => !q || a.displayName.toLowerCase().includes(q) || a.username.toLowerCase().includes(q) || (a.division || "").toLowerCase().includes(q));
            if (shown.length === 0) return <div className="soft" style={{ padding: 24, fontSize: 13 }}>No agents match “{search}”.</div>;
            return (
              <div className="agc-list no-scrollbar">
                {shown.map(({ a, rank }) => <LeaderEntry key={a.accountId} a={a} rank={rank} input={inputFor(a)} onOpen={() => setScanning(a)} />)}
              </div>
            );
          })()}
          {scanning && (
            <AgentIdentScan
              subject={{ photo: scanning.photo, name: scanning.displayName || scanning.username, username: scanning.username }}
              candidates={(ranked ?? []).map((x) => ({ photo: x.photo, username: x.username }))}
              onDone={() => { setOpenAgent(scanning); setScanning(null); }}
            />
          )}
          {openAgent && <AgentDossierModal a={openAgent} input={inputFor(openAgent)} meUsername={meUsername} onClose={() => setOpenAgent(null)} />}
        </>
      )}
      {tab === "week" && <AgentWeek isAdmin={meRole === "admin"} />}
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
