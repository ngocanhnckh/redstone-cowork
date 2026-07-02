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
function MiniGlobe({ geo }: { geo: { lat: number; long: number; city: string | null } | null }) {
  const W = 150, H = 78;
  const x = geo ? ((geo.long + 180) / 360) * W : W * 0.3;
  const y = geo ? ((90 - geo.lat) / 180) * H : H * 0.4;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 78, display: "block", borderRadius: 8, background: "rgb(var(--primary) / 0.05)", border: "1px solid var(--border)" }}>
        {[0.25, 0.5, 0.75].map((f) => <line key={`h${f}`} x1={0} y1={H * f} x2={W} y2={H * f} stroke="var(--border-strong)" strokeWidth={0.4} opacity={0.5} />)}
        {[0.2, 0.4, 0.6, 0.8].map((f) => <line key={`v${f}`} x1={W * f} y1={0} x2={W * f} y2={H} stroke="var(--border-strong)" strokeWidth={0.4} opacity={0.5} />)}
        <circle cx={x} cy={y} r={7} fill="none" stroke="rgb(var(--accent))" strokeWidth={0.8}>
          <animate attributeName="r" values="3;9;3" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.75;0;0.75" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={x} cy={y} r={2.4} fill="rgb(var(--accent))" />
        <line x1={x} y1={0} x2={x} y2={H} stroke="rgb(var(--accent))" strokeWidth={0.4} opacity={0.35} />
        <line x1={0} y1={y} x2={W} y2={y} stroke="rgb(var(--accent))" strokeWidth={0.4} opacity={0.35} />
      </svg>
      <div className="mono faint" style={{ fontSize: 10, marginTop: 5 }}>
        {geo ? `${geo.city ?? "unknown"} · ${geo.lat.toFixed(2)}, ${geo.long.toFixed(2)}` : "location: acquiring…"}
      </div>
    </div>
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
        <div style={{ gridColumn: "1 / -1" }}><MiniGlobe geo={t.latest.geo} /></div>
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

function sessionMetrics(s: SessionView) {
  const prompts = (s.transcript ?? []).filter((m) => m.role === "user").length;
  const all = [...(s.todos ?? []).map((t) => t.status === "completed"), ...(s.userTodos ?? []).map((t) => t.done)];
  return { prompts, todosDone: all.filter(Boolean).length, todosTotal: all.length, spentMs: s.attachedAt ? Date.now() - new Date(s.attachedAt).getTime() : 0 };
}

function SessionCard({ s, onClick, active }: { s: SessionView; onClick: () => void; active: boolean }) {
  const m = sessionMetrics(s);
  const waiting = s.status === "waiting";
  return (
    <div onClick={onClick} style={{ ...card, padding: "11px 13px", cursor: "pointer", borderColor: active ? "rgb(var(--primary-soft) / 0.6)" : "var(--border)", boxShadow: active ? "inset 0 0 0 1px rgb(var(--primary-soft) / 0.4)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: waiting ? "rgb(var(--accent))" : s.working ? "rgb(var(--primary-soft))" : "var(--border-strong)", boxShadow: waiting ? "0 0 0 3px rgb(var(--accent) / 0.18)" : "none" }} className={s.working ? "hud-pulse" : undefined} />
        <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName(s.cwd)}</span>
        <span style={{ flex: 1 }} />
        <span className="mono faint" style={{ fontSize: 9.5 }}>{s.machine}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {metric("Prompts", String(m.prompts))}
        {metric("Time", fmtDur(m.spentMs))}
        {metric("Todos", m.todosTotal ? `${m.todosDone}/${m.todosTotal}` : "—")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right: telemetry column
// ---------------------------------------------------------------------------
function TelemetryColumn({ tele }: { tele: HostTelemetryView[] }) {
  const sessions = useStore((s) => s.sessions);
  const focusId = useStore((s) => s.focusId);
  const setFocus = useStore((s) => s.setFocus);
  const fleet = useMemo(() => {
    const active = sessions.filter((s) => s.status === "active" || s.working).length;
    const waiting = sessions.filter((s) => s.status === "waiting").length;
    const prompts = sessions.reduce((n, s) => n + (s.transcript ?? []).filter((m) => m.role === "user").length, 0);
    const spent = sessions.reduce((n, s) => n + (s.attachedAt ? Date.now() - new Date(s.attachedAt).getTime() : 0), 0);
    return { active, waiting, prompts, spent };
  }, [sessions]);

  return (
    <motion.div className="no-scrollbar" style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}
      variants={STAGGER} initial="hidden" animate="show">
      <motion.div variants={RISE}><Clock /></motion.div>

      <motion.div variants={RISE} style={card}>
        <span className="hud-corner" />
        {kicker("Transmission")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 12 }}>
          {metric("Active", String(fleet.active))}
          {metric("Waiting", String(fleet.waiting))}
          {metric("Prompts", String(fleet.prompts))}
          {metric("Uptime", fmtDur(fleet.spent))}
        </div>
        <div className="mono faint" style={{ fontSize: 9.5, marginBottom: 4 }}>THROUGHPUT</div>
        <WaveLine height={34} color="rgb(var(--accent))" />
      </motion.div>

      <motion.div variants={RISE}>
        <div className="kicker" style={{ marginBottom: 8 }}>Hosts</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

      <motion.div variants={RISE}>
        <div className="kicker" style={{ marginBottom: 8 }}>Sessions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sessions.map((s) => (
            <motion.div key={s.id} layout whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.99 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
              <SessionCard s={s} active={s.id === focusId} onClick={() => setFocus(s.id)} />
            </motion.div>
          ))}
          {sessions.length === 0 && <span className="mono faint" style={{ fontSize: 11 }}>no sessions</span>}
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
  return (
    <div className="hud-root" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      <HudStyles />
      <span className="hud-grid" />
      <div style={{ position: "relative", zIndex: 1, height: "100%", display: "grid", gridTemplateColumns: "214px minmax(0,1fr) 372px", minHeight: 0 }}>
        <QueueRail />
        <FocusStage />
        <div style={{ borderLeft: "1px solid var(--border)", padding: "16px 16px", minHeight: 0, display: "flex" }}>
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
    `}</style>
  );
}
