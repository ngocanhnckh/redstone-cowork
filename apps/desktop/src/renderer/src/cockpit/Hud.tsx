import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { useStore } from "../store";
import { HostTelemetryView, SessionView } from "../types";
import QueueRail from "./QueueRail";
import FocusStage from "./FocusStage";

// Motion (motion.dev) entrance choreography for the widget column.
const STAGGER: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const RISE: Variants = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 240, damping: 26 } } };

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------
const fmtBytes = (b: number): string => {
  if (b <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};
const fmtBps = (b: number | null): string => (b == null ? "—" : `${fmtBytes(b)}/s`);
const fmtUptime = (s: number): string => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const timeAgo = (iso: string | null): string => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const fmtDur = (ms: number): string => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};
const projectName = (cwd: string): string => cwd.split("/").filter(Boolean).pop() ?? cwd;

// ---------------------------------------------------------------------------
// small primitives
// ---------------------------------------------------------------------------
function Sparkline({ data, max, height = 34, color = "rgb(var(--primary-soft))", animate = true }: { data: number[]; max?: number; height?: number; color?: string; animate?: boolean }) {
  const W = 100, H = height;
  const peak = Math.max(1, max ?? Math.max(...data, 1));
  const pts = data.length < 2 ? [] : data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (Math.max(0, Math.min(peak, v)) / peak) * (H - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      {pts.length > 0 && (
        <>
          <polyline points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={color} opacity={0.1} stroke="none" />
          <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
            className={animate ? "hud-draw" : undefined} />
        </>
      )}
    </svg>
  );
}

/** A decorative animated wave sparkline (used for ambient widgets / skeletons). */
function WaveLine({ color = "rgb(var(--primary-soft))", height = 40, phase = 0 }: { color?: string; height?: number; phase?: number }) {
  const [t, setT] = useState(0);
  useEffect(() => { let raf = 0; const loop = () => { setT((x) => x + 0.03); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); }, []);
  const W = 100, H = height;
  const pts = Array.from({ length: 41 }, (_, i) => {
    const x = (i / 40) * W;
    const y = H / 2 + Math.sin(i / 5 + t + phase) * (H / 3.2) * (0.6 + 0.4 * Math.sin(t / 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.85} />
    </svg>
  );
}

function Bar({ pct, color = "rgb(var(--primary-soft))" }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 999, transition: "width 0.7s cubic-bezier(.4,0,.2,1)" }} />
    </div>
  );
}

/** Segmented "scanning" meter like the reference. Animated sweep. */
function ScanBar({ pct, segments = 22 }: { pct: number; segments?: number }) {
  const lit = Math.round((pct / 100) * segments);
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < lit ? "hud-seg hud-seg-lit" : "hud-seg"} style={{ animationDelay: `${i * 0.05}s`, flex: 1, height: 14, borderRadius: 1 }} />
      ))}
    </div>
  );
}

/** Header text that "decodes" from scramble to the real string on mount. */
function Decode({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    const chars = "▚▞░▒▓#%*01";
    let frame = 0;
    const total = 14;
    const timer = setInterval(() => {
      frame++;
      const reveal = Math.floor((frame / total) * text.length);
      setOut(text.split("").map((c, i) => (i < reveal || c === " " ? c : chars[(Math.random() * chars.length) | 0])).join(""));
      if (frame >= total) { setOut(text); clearInterval(timer); }
    }, 45);
    return () => clearInterval(timer);
  }, [text]);
  return <span className={className} style={style}>{out}</span>;
}

/** Equirectangular mini-map with a pulsing dot at the host's location. */
/**
 * A wireframe globe that actually rotates: meridian ellipses whose horizontal
 * radius cycles each frame (classic spinning-wireframe look), latitude rings, and
 * a location marker that orbits with the globe — brightening on the near face and
 * dimming as it swings around the back.
 */
function RotatingGlobe({ geo, size = 150 }: { geo: { lat: number; long: number; city: string | null } | null; size?: number }) {
  const [t, setT] = useState(0);
  useEffect(() => { let raf = 0; const loop = () => { setT((x) => x + 0.012); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); }, []);
  const R = size / 2 - 4, cx = size / 2, cy = size / 2;
  const MERIDIANS = 6;
  // Marker: its longitude sweeps with rotation; sin(lon-t) < 0 ⇒ on the far side.
  const latRad = geo ? (geo.lat * Math.PI) / 180 : 0.4;
  const lonRad = geo ? (geo.long * Math.PI) / 180 : 0;
  const mLon = lonRad - t;
  const near = Math.cos(mLon) > 0;
  const mx = cx + R * Math.cos(latRad) * Math.sin(mLon);
  const my = cy - R * Math.sin(latRad);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, display: "block", filter: "drop-shadow(0 0 12px rgb(var(--primary-soft) / 0.15))" }}>
        <defs>
          <radialGradient id="globeglow" cx="42%" cy="38%" r="70%">
            <stop offset="0%" stopColor="rgb(var(--primary-soft) / 0.18)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={R} fill="url(#globeglow)" stroke="rgb(var(--primary-soft) / 0.55)" strokeWidth={1} />
        {/* latitude rings (static) */}
        {[-0.6, -0.3, 0, 0.3, 0.6].map((f, i) => {
          const ry = R * Math.cos((f * Math.PI) / 2) * 0.001 + R * 0.16 * (2 - Math.abs(f) * 2);
          const yy = cy - R * f;
          const rx = R * Math.sqrt(Math.max(0, 1 - f * f));
          return <ellipse key={`lat${i}`} cx={cx} cy={yy} rx={rx} ry={Math.max(2, ry)} fill="none" stroke="rgb(var(--primary-soft) / 0.28)" strokeWidth={0.6} />;
        })}
        {/* meridians (rotating) */}
        {Array.from({ length: MERIDIANS }, (_, i) => {
          const phase = t + (i * Math.PI) / MERIDIANS;
          const rx = Math.abs(R * Math.cos(phase));
          const front = Math.sin(phase) > 0;
          return <ellipse key={`mer${i}`} cx={cx} cy={cy} rx={Math.max(0.5, rx)} ry={R} fill="none" stroke="rgb(var(--primary-soft))" strokeWidth={0.7} opacity={front ? 0.5 : 0.18} />;
        })}
        {/* orbit ring + moving satellite tick */}
        <ellipse cx={cx} cy={cy} rx={R + 6} ry={(R + 6) * 0.34} fill="none" stroke="rgb(var(--accent) / 0.35)" strokeWidth={0.7} strokeDasharray="2 3" transform={`rotate(-18 ${cx} ${cy})`} />
        {(() => { const a = t * 1.6; const ox = cx + (R + 6) * Math.cos(a); const oy = cy + (R + 6) * 0.34 * Math.sin(a); return <circle cx={ox} cy={oy} r={1.8} fill="rgb(var(--accent))" transform={`rotate(-18 ${cx} ${cy})`} />; })()}
        {/* location marker */}
        <g opacity={near ? 1 : 0.25}>
          <circle cx={mx} cy={my} r={7} fill="none" stroke="rgb(var(--accent))" strokeWidth={0.8}>
            <animate attributeName="r" values="3;9;3" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={mx} cy={my} r={2.6} fill="rgb(var(--accent))" />
        </g>
      </svg>
      <div className="mono faint" style={{ fontSize: 10, marginTop: 4, textAlign: "center" }}>
        {geo ? <>{geo.city ?? "unknown"}<br />{geo.lat.toFixed(2)}°, {geo.long.toFixed(2)}°</> : "location: acquiring…"}
      </div>
    </div>
  );
}

/** A slowly-drifting wireframe satellite — the HUD's hero illustration. */
function Satellite() {
  return (
    <svg viewBox="0 0 240 150" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }} className="hud-float">
      <g stroke="rgb(var(--primary-soft) / 0.7)" strokeWidth={1} fill="none" strokeLinejoin="round">
        {/* left solar wing */}
        <g className="hud-panel-shimmer">
          <path d="M20 62 L88 82 L88 104 L20 84 Z" />
          {[0, 1, 2, 3].map((i) => <line key={`lw${i}`} x1={20 + i * 17} y1={62 + i * 5.6} x2={20 + i * 17} y2={84 + i * 5.6} />)}
          <line x1={20} y1={73} x2={88} y2={93} />
        </g>
        {/* right solar wing */}
        <g className="hud-panel-shimmer">
          <path d="M152 82 L220 62 L220 84 L152 104 Z" />
          {[0, 1, 2, 3].map((i) => <line key={`rw${i}`} x1={152 + i * 17} y1={104 - i * 5.6} x2={152 + i * 17} y2={82 - i * 5.6} />)}
          <line x1={152} y1={93} x2={220} y2={73} />
        </g>
        {/* central body */}
        <path d="M96 74 L120 64 L144 74 L144 104 L120 114 L96 104 Z" fill="rgb(var(--primary) / 0.06)" />
        <path d="M96 74 L120 84 L144 74 M120 84 L120 114" />
        {/* antenna dish */}
        <ellipse cx={120} cy={44} rx={16} ry={7} transform="rotate(-16 120 44)" />
        <line x1={120} y1={64} x2={120} y2={50} />
        <circle cx={120} cy={44} r={2} fill="rgb(var(--accent))" stroke="none" />
        {/* thruster */}
        <path d="M120 114 L114 126 L126 126 Z" />
      </g>
      <circle cx={120} cy={44} r={3} fill="none" stroke="rgb(var(--accent) / 0.6)" strokeWidth={0.6}>
        <animate attributeName="r" values="2;10;2" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.7;0;0.7" dur="3s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", background: "rgb(var(--primary) / 0.03)", position: "relative", overflow: "hidden" };
const kicker = (t: string) => <div style={{ marginBottom: 10 }}><Decode text={t} className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }} /></div>;
const metric = (label: string, value: string) => (
  <div><div className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div><div style={{ fontSize: 15, fontFamily: "var(--font-mono)" }}>{value}</div></div>
);

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div style={card}>
      <span className="hud-corner" />
      {kicker("Mission Time")}
      <div className="display" style={{ fontSize: 38, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>
        {now.toLocaleTimeString(undefined, { hour12: false })}<span className="hud-blink">▮</span>
      </div>
      <div className="mono faint" style={{ fontSize: 11, marginTop: 6 }}>
        {now.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </div>
    </div>
  );
}

function HostCard({ t }: { t: HostTelemetryView }) {
  const ramPct = t.latest.ramTotal > 0 ? (t.latest.ramUsed / t.latest.ramTotal) * 100 : 0;
  return (
    <div style={card}>
      <span className="hud-corner" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="ai-core" style={{ width: 8, height: 8 }} />
        <span className="display" style={{ fontSize: 15 }}>{t.machine}</span>
        <span style={{ flex: 1 }} />
        <span className="mono faint" style={{ fontSize: 10 }}>up {fmtUptime(t.latest.uptimeSec)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>CPU</span>
            <span className="mono" style={{ fontSize: 12 }}>{Math.round(t.latest.cpuPct)}%</span>
          </div>
          <Sparkline data={t.cpuHistory} max={100} />
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>RAM</span>
            <span className="mono" style={{ fontSize: 12 }}>{fmtBytes(t.latest.ramUsed)} / {fmtBytes(t.latest.ramTotal)}</span>
          </div>
          <div style={{ marginTop: 14 }}><Bar pct={ramPct} /></div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Network</span>
            <span className="mono faint" style={{ fontSize: 10.5 }}>↓ {fmtBps(t.latest.netRxBps)} · ↑ {fmtBps(t.latest.netTxBps)}</span>
          </div>
          <Sparkline data={t.netRxHistory} color="rgb(var(--accent))" height={28} />
        </div>
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center", marginTop: 4 }}><RotatingGlobe geo={t.latest.geo} size={128} /></div>
      </div>
    </div>
  );
}

/** Lively placeholder shown until a redstone agent streams real telemetry. */
function HostSkeleton() {
  return (
    <div style={card}>
      <span className="hud-corner" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="ai-core" style={{ width: 8, height: 8 }} />
        <Decode text="AWAITING HOST" className="mono" style={{ fontSize: 12, letterSpacing: "0.12em" }} />
        <span style={{ flex: 1 }} />
        <span className="mono faint hud-blink" style={{ fontSize: 10 }}>SCANNING…</span>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <div><div className="mono faint" style={{ fontSize: 9.5, marginBottom: 3 }}>CPU</div><ScanBar pct={45} /></div>
        <div><div className="mono faint" style={{ fontSize: 9.5, marginBottom: 3 }}>RAM</div><ScanBar pct={62} /></div>
        <div><div className="mono faint" style={{ fontSize: 9.5, marginBottom: 3 }}>NETWORK</div><WaveLine height={30} /></div>
      </div>
      <div className="mono faint" style={{ fontSize: 10, marginTop: 12, lineHeight: 1.5 }}>
        No agent connected. Run <span className="mono" style={{ color: "var(--text)" }}>redstone agent</span> on a host to stream live CPU / RAM / network / location.
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Right: telemetry column
// ---------------------------------------------------------------------------
function TelemetryColumn({ tele }: { tele: HostTelemetryView[] }) {
  const sessions = useStore((s) => s.sessions);
  const fleet = useMemo(() => {
    const active = sessions.filter((s) => s.status === "active" || s.working).length;
    const waiting = sessions.filter((s) => s.status === "waiting").length;
    const prompts = sessions.reduce((n, s) => n + (s.transcript ?? []).filter((m) => m.role === "user").length, 0);
    const spent = sessions.reduce((n, s) => n + (s.attachedAt ? Date.now() - new Date(s.attachedAt).getTime() : 0), 0);
    return { active, waiting, prompts, spent };
  }, [sessions]);
  const primaryGeo = tele.find((t) => t.latest.geo)?.latest.geo ?? null;

  return (
    <motion.div className="no-scrollbar" style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}
      variants={STAGGER} initial="hidden" animate="show">
      {/* Hero: wireframe satellite over a rotating orbital-location globe */}
      <motion.div variants={RISE} style={{ ...card, padding: "16px 16px 14px" }}>
        <span className="hud-corner" />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="ai-core" style={{ width: 8, height: 8 }} />
          <Decode text="RCW-ORBITAL" className="mono" style={{ fontSize: 12, letterSpacing: "0.12em" }} />
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 9, padding: "1px 7px", borderRadius: 999, background: "rgb(var(--accent) / 0.16)", color: "rgb(var(--accent))" }}>◉ IN ORBIT</span>
        </div>
        <Satellite />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 12, alignItems: "center", marginTop: 6 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {kicker("Orbital Location")}
            {metric("Nodes", `${tele.length} host${tele.length === 1 ? "" : "s"}`)}
            {metric("Sessions", String(sessions.length))}
            {metric("Velocity", "27,540 km/h")}
          </div>
          <RotatingGlobe geo={primaryGeo} size={150} />
        </div>
      </motion.div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <motion.div variants={RISE}><Clock /></motion.div>
        <motion.div variants={RISE} style={card}>
          <span className="hud-corner" />
          {kicker("Transmission")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
            {metric("Active", String(fleet.active))}
            {metric("Waiting", String(fleet.waiting))}
            {metric("Prompts", String(fleet.prompts))}
            {metric("Uptime", fmtDur(fleet.spent))}
          </div>
          <WaveLine height={30} color="rgb(var(--accent))" />
        </motion.div>
      </div>

      <motion.div variants={RISE}>
        <div className="kicker" style={{ marginBottom: 8 }}>Hosts</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          <AnimatePresence mode="popLayout">
            {tele.length === 0 ? (
              <motion.div key="skeleton" variants={RISE} initial="hidden" animate="show" exit={{ opacity: 0 }}><HostSkeleton /></motion.div>
            ) : tele.map((t) => (
              <motion.div key={t.hostId} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 240, damping: 26 }}>
                <HostCard t={t} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// HUD root
// ---------------------------------------------------------------------------
export default function Hud() {
  const [tele, setTele] = useState<HostTelemetryView[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => window.cowork.getTelemetry().then((t) => { if (alive) setTele(t); }).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // HUD = Flow mode (full FocusStage: all tabs + features + session switching via
  // the QueueRail) plus the telemetry widget column, over an animated backdrop.
  // The widget deck can expand to reclaim space from the chat for more widgets.
  const [wide, setWide] = useState(true);
  const cols = wide ? "214px minmax(360px,1fr) 560px" : "214px minmax(0,1fr) 372px";
  return (
    <div className="hud-root" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      <HudStyles />
      <span className="hud-grid" />
      <div style={{ position: "relative", zIndex: 1, height: "100%", display: "grid", gridTemplateColumns: cols, minHeight: 0 }}>
        <QueueRail />
        <FocusStage />
        <div style={{ borderLeft: "1px solid var(--border)", padding: "14px 16px", minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <button onClick={() => setWide((w) => !w)} title={wide ? "Shrink widget deck" : "Expand widget deck"}
            style={{ position: "absolute", top: 14, left: -13, zIndex: 3, width: 26, height: 26, borderRadius: 999, border: "1px solid var(--border-strong)", background: "var(--app-panel, #1b1712)", color: "var(--text-soft)", cursor: "pointer", fontSize: 12, lineHeight: 1, WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {wide ? "›" : "‹"}
          </button>
          <TelemetryColumn tele={tele} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-contained animation styles (no external key required — all native CSS/SVG)
// ---------------------------------------------------------------------------
function HudStyles() {
  return (
    <style>{`
      .hud-grid { position:absolute; inset:0; pointer-events:none; opacity:0.5;
        background-image:
          linear-gradient(rgb(var(--primary-soft) / 0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgb(var(--primary-soft) / 0.05) 1px, transparent 1px);
        background-size: 44px 44px; animation: hud-pan 24s linear infinite; }
      @keyframes hud-pan { from { background-position: 0 0, 0 0; } to { background-position: 44px 44px, 44px 44px; } }
      .hud-blink { animation: hud-blink 1.1s steps(1) infinite; }
      @keyframes hud-blink { 50% { opacity: 0; } }
      .hud-pulse { animation: hud-pulse 1.4s ease-in-out infinite; }
      @keyframes hud-pulse { 0%,100% { opacity:1; transform:scale(1);} 50% { opacity:0.4; transform:scale(1.35);} }
      .hud-draw { stroke-dasharray: 600; stroke-dashoffset: 600; animation: hud-draw 1.1s ease forwards; }
      @keyframes hud-draw { to { stroke-dashoffset: 0; } }
      .hud-seg { background: var(--border); transition: background .3s; }
      .hud-seg-lit { background: rgb(var(--accent)); animation: hud-seg 1.6s ease-in-out infinite; }
      @keyframes hud-seg { 0%,100% { opacity:.55;} 50% { opacity:1;} }
      .hud-corner { position:absolute; top:0; right:0; width:16px; height:16px; pointer-events:none;
        border-top:1px solid rgb(var(--primary-soft) / 0.5); border-right:1px solid rgb(var(--primary-soft) / 0.5);
        border-top-right-radius:14px; }
      .hud-rail-row:hover { background: rgb(var(--primary) / 0.09) !important; }
      .hud-term .hud-scanlines { position:absolute; inset:0; pointer-events:none; z-index:0; opacity:0.35;
        background: repeating-linear-gradient(to bottom, transparent 0, transparent 2px, rgb(var(--primary-soft) / 0.03) 3px, transparent 4px);
        animation: hud-scan 6s linear infinite; }
      @keyframes hud-scan { from { background-position:0 0; } to { background-position:0 200px; } }
      .hud-float { animation: hud-float 7s ease-in-out infinite; transform-origin: 50% 50%; }
      @keyframes hud-float { 0%,100% { transform: translateY(0) rotate(-1.2deg);} 50% { transform: translateY(-6px) rotate(1.2deg);} }
      .hud-panel-shimmer { animation: hud-panel 4.5s ease-in-out infinite; }
      @keyframes hud-panel { 0%,100% { opacity:0.55;} 50% { opacity:1;} }
    `}</style>
  );
}
