import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { useStore } from "../store";
import { HostTelemetryView } from "../types";
import QueueRail from "./QueueRail";
import TerminalStack from "./TerminalStack";
import FilesPanel from "./FilesPanel";
import BrowserStack from "./BrowserStack";
import DockerDeck from "./DockerDeck";
import DockerLogPanel from "./DockerLogPanel";
import NotesPanel from "./NotesPanel";
import ContextColumn from "./ContextColumn";
import AnswerDock from "./AnswerDock";
import Markdown from "./Markdown";
import ContextGauge from "./ContextGauge";
import ModeSelect from "./ModeSelect";
import TokenSpendWidget from "./TokenSpendWidget";
import { GitInfo } from "../types";

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

/**
 * Wraps RotatingGlobe in a measured container so the globe scales to the column
 * width instead of a fixed pixel size (canvas-style SVG needs a px size, so this
 * is one of the few places a ResizeObserver earns its keep). Capped so it never
 * grows gaudy or overflows the card horizontally.
 */
function ResponsiveGlobe({ geo }: { geo: { lat: number; long: number; city: string | null } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(128);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.max(96, Math.min(150, el.clientWidth - 8))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", display: "flex", justifyContent: "center", overflow: "hidden" }}>
      <RotatingGlobe geo={geo} size={size} />
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
    <div style={{ ...card, containerType: "inline-size" }}>
      <span className="hud-corner" />
      {kicker("Mission Time")}
      <div className="display" style={{ fontSize: "clamp(24px, 20cqw, 38px)", lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>CPU</span>
            <span className="mono" style={{ fontSize: 12 }}>{Math.round(t.latest.cpuPct)}%</span>
          </div>
          <Sparkline data={t.cpuHistory} max={100} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 2 }}>
            <span className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>RAM</span>
            <span className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtBytes(t.latest.ramUsed)} / {fmtBytes(t.latest.ramTotal)}</span>
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
        <div style={{ gridColumn: "1 / -1", marginTop: 4 }}><ResponsiveGlobe geo={t.latest.geo} /></div>
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

/** Latest commits + working-tree status for the focused session's repo. */
function GitPane() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!session) { setInfo(null); return; }
    setLoading(true);
    window.cowork.gitInfo(session.cwd, session.machine)
      .then((r) => setInfo(r as GitInfo))
      .catch(() => setInfo({ ok: false, repo: false, branch: null, ahead: 0, behind: 0, dirty: 0, commits: [] }))
      .finally(() => setLoading(false));
  };
  useEffect(load, [session?.id, session?.cwd, session?.machine]);
  // Refresh periodically so new commits appear (git ops happen out of band).
  useEffect(() => { const t = setInterval(load, 20_000); return () => clearInterval(t); }, [session?.id, session?.cwd, session?.machine]);

  return (
    <div style={{ ...card, padding: "13px 15px" }}>
      <span className="hud-corner" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12 }}>⎇</span>
        <Decode text="Git Activity" className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }} />
        <span style={{ flex: 1 }} />
        {info?.repo && info.branch && (
          <span className="mono" style={{ fontSize: 9.5, padding: "1px 8px", borderRadius: 999, background: "rgb(var(--primary) / 0.16)" }}>{info.branch}</span>
        )}
        <button onClick={load} title="Refresh" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "1px 7px", fontSize: 10, cursor: "pointer" }}>↻</button>
      </div>

      {!session ? (
        <span className="mono faint" style={{ fontSize: 11 }}>no session selected</span>
      ) : loading && !info ? (
        <span className="mono faint hud-blink" style={{ fontSize: 11 }}>reading repo…</span>
      ) : info && !info.ok ? (
        <div style={{ fontSize: 11 }}>
          <div style={{ color: "#e0736a" }}>couldn't read repo</div>
          <div className="mono faint" style={{ fontSize: 10, marginTop: 4, lineHeight: 1.5, wordBreak: "break-word" }}>{info.error}</div>
          {/(resolve|connect|timed out|refused|Host)/i.test(info.error ?? "") && (
            <div className="mono faint" style={{ fontSize: 10, marginTop: 4 }}>SSH host for <b>{session.machine}</b> may not be set up — configure it in the Terminal/Browser tab.</div>
          )}
        </div>
      ) : !info?.repo ? (
        <span className="mono faint" style={{ fontSize: 11 }}>not a git repository</span>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 11 }}>
            {metric("Ahead", `↑${info.ahead}`)}
            {metric("Behind", `↓${info.behind}`)}
            {metric("Dirty", info.dirty ? `● ${info.dirty}` : "clean")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {info.commits.length === 0 && <span className="mono faint" style={{ fontSize: 11 }}>no commits</span>}
            {info.commits.map((c, i) => (
              <div key={c.hash + i} style={{ display: "flex", gap: 9, padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: i === 0 ? "rgb(var(--accent))" : "var(--border-strong)", marginTop: 3 }} className={i === 0 ? "hud-pulse" : undefined} />
                  {i < info.commits.length - 1 && <span style={{ width: 1, flex: 1, background: "var(--border)", marginTop: 2 }} />}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.subject}>{c.subject}</div>
                  <div className="mono faint" style={{ fontSize: 9.5, marginTop: 1 }}>
                    <span style={{ color: "rgb(var(--primary-soft))" }}>{c.hash}</span> · {c.author} · {c.relative}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Right: telemetry column
// ---------------------------------------------------------------------------
function TelemetryColumn({ tele }: { tele: HostTelemetryView[] }) {
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const focusId = useStore((s) => s.focusId);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const fleet = useMemo(() => {
    const active = sessions.filter((s) => s.status === "active" || s.working).length;
    const waiting = sessions.filter((s) => s.status === "waiting").length;
    const prompts = sessions.reduce((n, s) => n + (s.transcript ?? []).filter((m) => m.role === "user").length, 0);
    const spent = sessions.reduce((n, s) => n + (s.attachedAt ? Date.now() - new Date(s.attachedAt).getTime() : 0), 0);
    return { active, waiting, prompts, spent };
  }, [sessions]);
  // Only the host that runs the SELECTED session (matched by machine name).
  const hostTele = session ? tele.find((t) => t.machine === session.machine) ?? null : null;
  return (
    <motion.div className="no-scrollbar" style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}
      variants={STAGGER} initial="hidden" animate="show">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
        <motion.div variants={RISE}><Clock /></motion.div>
        <motion.div variants={RISE} style={{ ...card, minWidth: 0 }}>
          <span className="hud-corner" />
          {kicker("Transmission")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))", gap: 12, marginBottom: 10 }}>
            {metric("Active", String(fleet.active))}
            {metric("Waiting", String(fleet.waiting))}
            {metric("Prompts", String(fleet.prompts))}
            {metric("Uptime", fmtDur(fleet.spent))}
          </div>
          <WaveLine height={30} color="rgb(var(--accent))" />
        </motion.div>
      </div>

      {/* System status — only the host machine of the selected session */}
      <motion.div variants={RISE}>
        <div className="kicker" style={{ marginBottom: 8 }}>System status{session ? ` · ${session.machine}` : ""}</div>
        <AnimatePresence mode="popLayout">
          {hostTele ? (
            <motion.div key={hostTele.hostId} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 240, damping: 26 }}>
              <HostCard t={hostTele} />
            </motion.div>
          ) : (
            <motion.div key="skeleton" variants={RISE} initial="hidden" animate="show" exit={{ opacity: 0 }}><HostSkeleton /></motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Token spend for the selected session */}
      <motion.div variants={RISE}><TokenSpendWidget /></motion.div>

      {/* Git activity for the selected session's repo — below system status */}
      <motion.div variants={RISE}><GitPane /></motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Center console: chat + terminal + files, split into three panes
// ---------------------------------------------------------------------------
const ACTIONABLE = ["question", "permission", "mode"];

/** Compact terminal-styled chat for the focused session (full markdown render). */
function ChatPane() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);
  const pendingMap = useStore((s) => s.pending);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Collapsible "you last said" reminder bubble state (persisted, shared).
  const [ctxOpen, setCtxOpen] = useState(() => {
    try { return localStorage.getItem("rcw.chat.ctxBubble") !== "0"; } catch { return true; }
  });
  const toggleCtx = () => setCtxOpen((o) => {
    const next = !o;
    try { localStorage.setItem("rcw.chat.ctxBubble", next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });

  const id = focusId;
  const session = sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);
  const transcript = session?.transcript ?? [];
  const pending = id ? pendingMap[id] ?? [] : [];
  const timeline = [...transcript, ...pending.map((p) => ({ role: "user" as const, text: p.text }))];
  // The most recent thing YOU sent to THIS session — surfaced as a pinned reminder
  // so switching sessions still shows the context of what you last asked here.
  let lastSent: string | null = null;
  for (let i = timeline.length - 1; i >= 0; i--) { if (timeline[i].role === "user") { lastSent = timeline[i].text; break; } }
  const sessionDecisions = decisions.filter((d) => d.sessionId === id);
  const actionable = sessionDecisions.find((d) => ACTIONABLE.includes(d.kind));
  const decision = actionable ?? sessionDecisions[0];
  const isWorking = !!session && session.status !== "lost" && !actionable && (!!session.working || pending.length > 0);

  useEffect(() => {
    if (scrollRef.current && stick.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.transcript, pending.length, isWorking]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Toolbar: permission-mode dropdown + context-window gauge */}
      {session && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <ModeSelect session={session} />
          <span style={{ flex: 1 }} />
          <ContextGauge contextTokens={session.contextTokens} model={session.model} />
        </div>
      )}
      {/* Pinned reminder of the last message you sent to this session. */}
      {session && lastSent && (
        <div style={{ flexShrink: 0, margin: "10px 14px 0", borderRadius: 12, border: "1px solid rgb(var(--accent) / 0.3)", background: "rgb(var(--accent) / 0.06)", overflow: "hidden" }}>
          <div onClick={toggleCtx} title="Your last message to this session" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 11px", cursor: "pointer", userSelect: "none" }}>
            <span className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgb(var(--accent))" }}>↩ you last said</span>
            <span style={{ flex: 1 }} />
            <span className="mono faint" style={{ fontSize: 11 }}>{ctxOpen ? "▾" : "▸"}</span>
          </div>
          {ctxOpen && (
            <div className="no-scrollbar" style={{ maxHeight: 120, overflowY: "auto", padding: "0 12px 10px", fontSize: 12, lineHeight: 1.5, color: "var(--text-soft)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {lastSent}
            </div>
          )}
        </div>
      )}
      <div ref={scrollRef} onScroll={() => { const el = scrollRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--font-mono)" }}>
        {!session && <span className="mono faint hud-blink" style={{ fontSize: 12 }}>no session selected</span>}
        {session && timeline.length === 0 && !session.latestAnswer && <span className="mono faint hud-blink" style={{ fontSize: 12 }}>awaiting output…</span>}
        {timeline.map((m, i) =>
          m.role === "user" ? (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: "rgb(var(--accent))", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ opacity: 0.7 }}>❯ </span>{m.text}
            </div>
          ) : (
            <div key={i} style={{ borderLeft: "2px solid rgb(var(--primary-soft) / 0.4)", paddingLeft: 12 }}>
              <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 5, opacity: 0.6 }}>◇ claude</div>
              <div style={{ fontFamily: "var(--font-body)" }}><Markdown>{m.text}</Markdown></div>
            </div>
          )
        )}
        {isWorking && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-soft)" }}>
            <span className="eq">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="eq-bar" style={{ animationDelay: `${i * 0.13}s` }} />)}</span>
            <span className="shimmer mono" style={{ fontSize: 11.5, letterSpacing: "0.06em" }}>processing<span className="hud-blink">▮</span></span>
          </div>
        )}
      </div>
      {session && <AnswerDock decision={decision} working={isWorking} sessionId={id ?? undefined} />}
    </div>
  );
}

// Fixed singleton windows. chat/term/files/browser also participate in the tiled
// grid; tasks is windows-mode only. Docker Log windows are DYNAMIC (ids "docker:N")
// and can be spawned more than once, so they live outside this union.
type FixedKey = "chat" | "term" | "files" | "browser" | "tasks" | "notes";
type GridKey = "chat" | "term" | "files" | "browser";
type ConsoleView = "ctf" | "cb" | "ctb" | "fb";
type HudLayout = "grid" | "windows";

const FIXED: { key: FixedKey; title: string; icon: string }[] = [
  { key: "chat", title: "Chat", icon: "◇" },
  { key: "term", title: "Terminal", icon: "❯_" },
  { key: "files", title: "Files", icon: "▤" },
  { key: "browser", title: "Browser", icon: "◍" },
  { key: "tasks", title: "Tasks", icon: "☑" },
  { key: "notes", title: "Notes", icon: "✎" },
];
const GRID_PANELS: GridKey[] = ["chat", "term", "files", "browser"];
const isDockerId = (id: string): boolean => id.startsWith("docker:");

// ---------------------------------------------------------------------------
// Windows sub-mode: free-floating window geometry (persisted to localStorage)
// ---------------------------------------------------------------------------
type WinState = { x: number; y: number; w: number; h: number; min: boolean };
// Geometry is keyed by window id (fixed keys + dynamic "docker:N" ids). z is the
// stacking order (last = frontmost); dockerIds tracks the live Docker Log windows;
// seq mints unique docker ids.
type WinMap = {
  wins: Record<string, WinState>;
  dockerIds: string[];
  z: string[];
  seq: number;
  _init: boolean;
};
const WIN_KEY = "rcw.hud.windows.v2"; // v2: id-keyed map with tasks + dynamic docker windows
const WIN_MIN_W = 280;
const WIN_MIN_H = 170;

// Near-solid dark glass shared by floating window frames + the app dock, so text
// behind them stays fully legible (mirrors the slash-command popup treatment).
const WIN_GLASS: React.CSSProperties = {
  background: "color-mix(in srgb, var(--app-panel, #1b1712) 94%, transparent)",
  backdropFilter: "blur(30px) saturate(1.4)",
  WebkitBackdropFilter: "blur(30px) saturate(1.4)",
};

/** Clamp a window so it is never larger than the canvas and stays fully in view. */
function clampWin(win: WinState, cw: number, ch: number): WinState {
  const w = Math.min(win.w, Math.max(WIN_MIN_W, cw));
  const h = Math.min(win.h, Math.max(WIN_MIN_H, ch));
  const x = Math.max(0, Math.min(win.x, cw - w));
  const y = Math.max(0, Math.min(win.y, ch - h));
  return { ...win, x, y, w, h };
}

/** Fresh default geometry: the 4 grid panels tiled 2×2, Tasks centered & hidden. */
function defaultWins(): WinMap {
  const base: WinState = { x: 20, y: 20, w: 520, h: 320, min: false };
  return {
    wins: {
      chat: { ...base },
      term: { ...base, x: 560 },
      files: { ...base, y: 360 },
      browser: { ...base, x: 560, y: 360 },
      tasks: { x: 120, y: 80, w: 440, h: 480, min: true },
      notes: { x: 170, y: 96, w: 760, h: 540, min: true },
    },
    dockerIds: [],
    z: ["chat", "term", "files", "browser", "tasks", "notes"],
    seq: 0,
    _init: false,
  };
}

/** 2×2 tiling for the four grid panels once the console area has a measured size. */
function tiledGrid(rect: { width: number; height: number }): Record<string, WinState> {
  const pad = 8, gap = 12;
  const w = Math.max(WIN_MIN_W, (rect.width - pad * 2 - gap) / 2);
  const h = Math.max(WIN_MIN_H, (rect.height - pad * 2 - gap) / 2);
  const c2 = pad + w + gap, r2 = pad + h + gap;
  return {
    chat: { x: pad, y: pad, w, h, min: false },
    term: { x: c2, y: pad, w, h, min: false },
    files: { x: pad, y: r2, w, h, min: false },
    browser: { x: c2, y: r2, w, h, min: false },
  };
}

/** Load persisted geometry, or fresh defaults that get tiled on first paint. */
function loadWins(): WinMap {
  const base = defaultWins();
  try {
    const raw = localStorage.getItem(WIN_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<WinMap>;
    if (!p.wins || typeof p.wins !== "object") return base;
    const wins: Record<string, WinState> = { ...base.wins, ...p.wins };
    const dockerIds = Array.isArray(p.dockerIds)
      ? p.dockerIds.filter((id): id is string => typeof id === "string" && !!wins[id])
      : [];
    const allIds = [...FIXED.map((f) => f.key), ...dockerIds];
    const z = (Array.isArray(p.z) ? p.z.filter((id) => allIds.includes(id)) : []) as string[];
    for (const id of allIds) if (!z.includes(id)) z.push(id);
    return { wins, dockerIds, z, seq: typeof p.seq === "number" ? p.seq : 0, _init: p._init ?? true };
  } catch {
    return base;
  }
}

/**
 * Layout catalog. Every view is a CSS-grid arrangement of the SAME four panel
 * instances — a view only reassigns each panel's grid-area (or hides it). Because
 * the panels never leave the grid, switching views never remounts them, so shells,
 * pages and editors keep their state. `areas` maps a panel → its grid-area name
 * (absent = hidden in that view).
 */
const VIEWS: Record<ConsoleView, { label: string; cols: string; rows: string; template: string; areas: Partial<Record<GridKey, string>> }> = {
  ctf: { label: "Chat · Term · Files", cols: "1.1fr 1fr", rows: "1.5fr 1fr", template: `"files chat" "files term"`, areas: { chat: "chat", term: "term", files: "files" } },
  cb: { label: "Chat · Browser", cols: "1fr 1.3fr", rows: "1fr", template: `"chat browser"`, areas: { chat: "chat", browser: "browser" } },
  ctb: { label: "Chat · Term · Browser", cols: "1fr 1.2fr", rows: "1.2fr 1fr", template: `"chat browser" "term browser"`, areas: { chat: "chat", term: "term", browser: "browser" } },
  fb: { label: "Files · Browser", cols: "1fr 1.2fr", rows: "1fr", template: `"files browser"`, areas: { files: "files", browser: "browser" } },
};
const VIEW_ORDER: ConsoleView[] = ["ctf", "cb", "ctb", "fb"];

/**
 * A single titled panel wrapper that stays mounted at all times. Its CSS switches
 * between two placement regimes without ever re-parenting the child panel:
 *   • Grid mode   — CSS grid-area placement (hidden via display:none when absent).
 *   • Windows mode — absolute-positioned floating window (drag / resize / raise).
 * This one-wrapper-two-styles design is what preserves the no-remount invariant:
 * terminals, browsers and editors inside `children` never unmount when the user
 * toggles Grid ↔ Windows, switches views, or raises a window.
 */
function PanelShell({
  layout, title, area, win, zIndex, canvasRef, onFocus, onChange, onMinimize, onClose, children,
}: {
  layout: HudLayout;
  title: string;
  area?: string;
  win: WinState;
  zIndex: number;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onFocus: () => void;
  onChange: (patch: Partial<WinState>) => void;
  onMinimize: () => void;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const grid = layout === "grid";
  const shown = grid ? !!area : !win.min;

  // Pointer-driven drag of the whole window (title-bar handle). We CAPTURE the
  // pointer on the handle so pointermove/pointerup are always delivered even while
  // the cursor passes over a <webview> (terminal/browser) — otherwise the guest
  // page swallows pointerup, the drag state leaks, and the UI appears frozen (can't
  // scroll/type until you click around). This mirrors the right-column resizer.
  const startDrag = (e: React.PointerEvent) => {
    if (grid) return;
    e.preventDefault();
    onFocus();
    const handle = e.currentTarget as HTMLElement;
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rect = canvasRef.current?.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, ox = win.x, oy = win.y;
    const move = (ev: PointerEvent) => {
      let nx = ox + (ev.clientX - sx), ny = oy + (ev.clientY - sy);
      if (rect) { nx = Math.max(0, Math.min(nx, rect.width - win.w)); ny = Math.max(0, Math.min(ny, rect.height - win.h)); }
      onChange({ x: nx, y: ny });
    };
    const up = (ev: PointerEvent) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  // Pointer-driven resize from the bottom-right corner (same pointer-capture fix).
  const startResize = (e: React.PointerEvent) => {
    if (grid) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const handle = e.currentTarget as HTMLElement;
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rect = canvasRef.current?.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, ow = win.w, oh = win.h;
    const move = (ev: PointerEvent) => {
      let nw = Math.max(WIN_MIN_W, ow + (ev.clientX - sx));
      let nh = Math.max(WIN_MIN_H, oh + (ev.clientY - sy));
      if (rect) { nw = Math.min(nw, rect.width - win.x); nh = Math.min(nh, rect.height - win.y); }
      onChange({ w: nw, h: nh });
    };
    const up = (ev: PointerEvent) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const wrapperStyle: React.CSSProperties = grid
    ? { ...card, padding: 0, gridArea: area, display: shown ? "flex" : "none", flexDirection: "column", minHeight: 0, minWidth: 0 }
    : {
        ...card, ...WIN_GLASS, padding: 0, position: "absolute", left: win.x, top: win.y, width: win.w, height: win.h,
        display: shown ? "flex" : "none", flexDirection: "column", minHeight: 0, minWidth: 0, zIndex,
        boxShadow: "0 12px 40px rgb(0 0 0 / 0.5)",
      };

  return (
    <div style={wrapperStyle} onPointerDown={grid ? undefined : onFocus}>
      <div
        onPointerDown={startDrag}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "7px 13px", borderBottom: "1px solid var(--border)", flexShrink: 0,
          cursor: grid ? "default" : "move", ...(grid ? {} : ({ WebkitAppRegion: "no-drag", userSelect: "none" } as React.CSSProperties)),
        }}
      >
        {!grid && <span style={{ width: 7, height: 7, borderRadius: 999, background: "rgb(var(--accent))", flexShrink: 0 }} className="hud-pulse" />}
        <Decode text={title} className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }} />
        {!grid && (
          <>
            <span style={{ flex: 1 }} />
            <button onPointerDown={(e) => e.stopPropagation()} onClick={onFocus} title="Bring to front"
              style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "0 7px", fontSize: 11, lineHeight: "18px", cursor: "pointer" }}>⤒</button>
            <button onPointerDown={(e) => e.stopPropagation()} onClick={onMinimize} title="Minimize"
              style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "0 7px", fontSize: 11, lineHeight: "18px", cursor: "pointer" }}>—</button>
            {onClose && (
              <button onPointerDown={(e) => e.stopPropagation()} onClick={onClose} title="Close window"
                style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "0 7px", fontSize: 11, lineHeight: "18px", cursor: "pointer" }}>✕</button>
            )}
          </>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
      {!grid && (
        <div onPointerDown={startResize} title="Resize"
          style={{ position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 0 50%, rgb(var(--primary-soft) / 0.55) 50% 60%, transparent 60% 72%, rgb(var(--primary-soft) / 0.55) 72% 82%, transparent 82%)" }} />
      )}
    </div>
  );
}

/**
 * The HUD center. Two sub-modes over the SAME four always-mounted panel instances:
 *   • Grid    — a view switcher picks one of four CSS-grid layouts.
 *   • Windows — the four panels become draggable / resizable floating windows.
 * Switching sub-modes only changes each panel wrapper's CSS, so panels never remount.
 */
function HudConsole() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const openBrowser = useStore((s) => s.openBrowser);
  const openTerminal = useStore((s) => s.openTerminal);
  const [view, setView] = useState<ConsoleView>("ctf");
  const [layout, setLayout] = useState<HudLayout>("grid");
  const [wins, setWins] = useState<WinMap>(loadWins);
  const canvasRef = useRef<HTMLDivElement>(null);
  const cfg = VIEWS[view];
  const none = <div className="mono faint" style={{ padding: 14, fontSize: 11 }}>no session</div>;

  // Persist window geometry / z-order / minimized flags.
  useEffect(() => { try { localStorage.setItem(WIN_KEY, JSON.stringify(wins)); } catch { /* ignore */ } }, [wins]);

  // First time Windows mode is shown with no saved layout, tile from the console size.
  useEffect(() => {
    if (layout === "windows" && !wins._init && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setWins((w) => ({ ...w, wins: { ...w.wins, ...tiledGrid(rect), tasks: clampWin(w.wins.tasks, rect.width, rect.height) }, _init: true }));
      }
    }
  }, [layout, wins._init]);

  // Keep every window inside the console canvas: whenever the canvas resizes (e.g.
  // leaving macOS fullscreen shrinks it), reflow each window so it is never larger
  // than the canvas and never sits out of view. Clamped values are persisted.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const reflow = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setWins((w) => {
        let changed = false;
        const nextWins = { ...w.wins };
        for (const id of Object.keys(w.wins)) {
          const c = clampWin(w.wins[id], rect.width, rect.height);
          const cur = w.wins[id];
          if (c.x !== cur.x || c.y !== cur.y || c.w !== cur.w || c.h !== cur.h) { nextWins[id] = c; changed = true; }
        }
        return changed ? { ...w, wins: nextWins } : w;
      });
    };
    const ro = new ResizeObserver(reflow);
    ro.observe(el);
    reflow();
    return () => ro.disconnect();
  }, []);

  // A panel is "active" (kept alive / streaming) when visible in the current mode.
  const grid = layout === "grid";
  const termActive = grid ? !!cfg.areas.term : !wins.wins.term.min;
  const browserActive = grid ? !!cfg.areas.browser : !wins.wins.browser.min;

  // Keep this session's browser/terminal alive in their persistent stacks the
  // first time they become visible, so switching sessions never reloads them.
  useEffect(() => { if (browserActive && session) openBrowser(session.id); }, [browserActive, session?.id, openBrowser]);
  useEffect(() => { if (termActive && session) openTerminal(session.id); }, [termActive, session?.id, openTerminal]);

  const raise = (id: string) => setWins((w) => (w.z[w.z.length - 1] === id ? w : { ...w, z: [...w.z.filter((k) => k !== id), id] }));
  const patchWin = (id: string, patch: Partial<WinState>) =>
    setWins((w) => ({ ...w, wins: { ...w.wins, [id]: { ...w.wins[id], ...patch } } }));

  // Dock item click: minimized/hidden → restore + raise; visible-but-behind → raise
  // to front; visible-and-frontmost → toggle-minimize (second click hides it).
  const dockClick = (id: string) => setWins((w) => {
    const cur = w.wins[id];
    if (!cur) return w;
    const front = w.z[w.z.length - 1];
    if (cur.min) return { ...w, wins: { ...w.wins, [id]: { ...cur, min: false } }, z: [...w.z.filter((k) => k !== id), id] };
    if (front === id) return { ...w, wins: { ...w.wins, [id]: { ...cur, min: true } } };
    return { ...w, z: [...w.z.filter((k) => k !== id), id] };
  });

  // Spawn a new Docker Log window (dock right-click or the "＋ docker" launcher).
  // Each gets a unique id so several can tail different containers at once.
  const createDocker = (e?: React.MouseEvent) => {
    e?.preventDefault();
    setLayout("windows");
    setWins((w) => {
      const n = w.seq + 1;
      const id = `docker:${n}`;
      const rect = canvasRef.current?.getBoundingClientRect();
      const off = (w.dockerIds.length * 30) % 150;
      let ws: WinState = { x: 70 + off, y: 56 + off, w: 560, h: 360, min: false };
      if (rect && rect.width > 0 && rect.height > 0) ws = clampWin(ws, rect.width, rect.height);
      return { ...w, seq: n, dockerIds: [...w.dockerIds, id], wins: { ...w.wins, [id]: ws }, z: [...w.z.filter((k) => k !== id), id] };
    });
  };
  const closeDocker = (id: string) => setWins((w) => {
    const nextWins = { ...w.wins };
    delete nextWins[id];
    return { ...w, dockerIds: w.dockerIds.filter((d) => d !== id), wins: nextWins, z: w.z.filter((k) => k !== id) };
  });

  const childFor = (id: string): React.ReactNode => {
    switch (id) {
      case "chat": return <ChatPane />;
      case "term": return <TerminalStack activeId={session?.id} active={termActive} />;
      case "files": return session ? <FilesPanel key={`${session.id}-hud-files`} sessionId={session.id} cwd={session.cwd} machine={session.machine} /> : none;
      case "browser": return <BrowserStack activeId={session?.id} active={browserActive} />;
      case "tasks": return <ContextColumn sessionId={session?.id} />;
      case "notes": return <NotesPanel active={!grid && !wins.wins.notes?.min} />;
      default:
        return isDockerId(id) ? <DockerLogPanel streamId={id} active={!grid && !wins.wins[id]?.min} /> : null;
    }
  };

  // All windows to render: fixed singletons (chat/term/files/browser/tasks) + the
  // dynamic Docker Log windows. Grid areas apply only to the four grid panels;
  // tasks & docker have no area, so they are display:none in grid mode.
  const windowList: { id: string; title: string; area?: string; closable?: boolean }[] = [
    ...FIXED.map((f) => ({
      id: f.key,
      title: f.title,
      area: (GRID_PANELS as string[]).includes(f.key) ? cfg.areas[f.key as GridKey] : undefined,
    })),
    ...wins.dockerIds.map((id, i) => ({ id, title: `Docker ${i + 1}`, closable: true })),
  ];
  // Dock entries: fixed panels, then one launcher per open Docker Log window, then
  // a "＋ docker" button. Right-clicking any docker entry also spawns a new one.
  const dockItems: { id: string; title: string; icon: string }[] = [
    ...FIXED.map((f) => ({ id: f.key, title: f.title, icon: f.icon })),
    ...wins.dockerIds.map((id, i) => ({ id, title: `Docker ${i + 1}`, icon: "🐳" })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, padding: "12px 14px" }}>
      {/* header: identity + (grid) view switcher + Grid/Windows sub-mode toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        {session && (
          <>
            <span className="display" style={{ fontSize: 16 }}>{projectName(session.cwd)}</span>
            <span className="mono faint" style={{ fontSize: 10 }}>{session.machine} · {session.gitBranch ?? "no-branch"}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        {grid && (
          <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 999, border: "1px solid var(--border)" }}>
            {VIEW_ORDER.map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "5px 11px", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 10.5, cursor: "pointer", border: 0, whiteSpace: "nowrap",
                background: view === v ? "rgb(var(--primary) / 0.28)" : "transparent", color: view === v ? "#fff" : "var(--text-soft)",
              }}>{VIEWS[v].label}</button>
            ))}
          </div>
        )}
        {/* Minimized windows are restored from the app dock (Windows mode). */}
        {/* Grid ↔ Windows sub-mode toggle. */}
        <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 999, border: "1px solid var(--border)" }}>
          {(["grid", "windows"] as HudLayout[]).map((l) => (
            <button key={l} onClick={() => setLayout(l)} title={l === "grid" ? "Tiled grid" : "Free-floating windows"} style={{
              padding: "5px 11px", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 10.5, cursor: "pointer", border: 0, whiteSpace: "nowrap",
              background: layout === l ? "rgb(var(--primary) / 0.28)" : "transparent", color: layout === l ? "#fff" : "var(--text-soft)",
            }}>{l === "grid" ? "Grid" : "Windows"}</button>
          ))}
        </div>
      </div>

      {/* console body — the four panels are ALWAYS mounted here. In grid mode the
          container is a CSS grid; in windows mode it is a positioning canvas. Each
          PanelShell switches its own placement CSS; the child panels never remount. */}
      <div ref={canvasRef} style={grid
        ? { flex: 1, minHeight: 0, display: "grid", gap: 10, gridTemplateColumns: cfg.cols, gridTemplateRows: cfg.rows, gridTemplateAreas: cfg.template }
        : { flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        {windowList.map((p) => (
          <PanelShell
            key={p.id}
            layout={layout}
            title={p.title}
            area={p.area}
            win={wins.wins[p.id]}
            zIndex={wins.z.indexOf(p.id) + 1}
            canvasRef={canvasRef}
            onFocus={() => raise(p.id)}
            onChange={(patch) => patchWin(p.id, patch)}
            onMinimize={() => patchWin(p.id, { min: true })}
            onClose={p.closable ? () => closeDocker(p.id) : undefined}
          >
            {childFor(p.id)}
          </PanelShell>
        ))}

        {/* macOS-style app dock — the single place to restore / focus windows. */}
        {!grid && (
          <div style={{
            position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", zIndex: 1000,
            display: "flex", alignItems: "flex-end", gap: 6, padding: "8px 10px 6px", borderRadius: 18,
            border: "1px solid var(--border-strong)", boxShadow: "0 12px 40px rgb(0 0 0 / 0.5)", ...WIN_GLASS,
          }}>
            <span className="hud-corner" />
            {dockItems.map((p) => {
              const open = !wins.wins[p.id]?.min;
              const front = open && wins.z[wins.z.length - 1] === p.id;
              const docker = isDockerId(p.id);
              return (
                <button key={p.id} onClick={() => dockClick(p.id)}
                  onContextMenu={docker ? createDocker : undefined}
                  title={
                    docker
                      ? `${p.title} — click to focus/minimize · right-click for a new Docker window`
                      : open ? (front ? `${p.title} (click to minimize)` : `Focus ${p.title}`) : `Restore ${p.title}`
                  }
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 46, padding: "6px 0 3px",
                    borderRadius: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
                    border: front ? "1px solid rgb(var(--accent) / 0.55)" : "1px solid transparent",
                    background: front ? "rgb(var(--primary) / 0.22)" : open ? "rgb(var(--primary) / 0.10)" : "transparent",
                    color: open ? "var(--text)" : "var(--text-soft)", opacity: open ? 1 : 0.6,
                    transition: "background .18s, opacity .18s, border-color .18s",
                  }}>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{p.icon}</span>
                  <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>{p.title}</span>
                  <span style={{
                    width: 4, height: 4, borderRadius: 999, marginTop: 1,
                    background: open ? "rgb(var(--accent))" : "transparent",
                  }} className={front ? "hud-pulse" : undefined} />
                </button>
              );
            })}
            {/* Launcher: open another Docker Log window. */}
            <button onClick={createDocker} onContextMenu={createDocker} title="New Docker log window"
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 46, padding: "6px 0 3px",
                borderRadius: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
                border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-soft)",
              }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>🐳</span>
              <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>＋ log</span>
              <span style={{ width: 4, height: 4, marginTop: 1 }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HUD root
// ---------------------------------------------------------------------------
// The right telemetry column is user-resizable via a drag handle on its left
// edge. Width is clamped to [RIGHT_MIN, min(RIGHT_MAX_ABS, 40% of the HUD)] and
// persisted so it survives reloads.
const HUD_RIGHT_KEY = "rcw.hud.rightWidth";
const RIGHT_MIN = 240;
const RIGHT_MAX_ABS = 560;
const RIGHT_DEFAULT = 420;
const loadRightWidth = (): number => {
  try {
    const v = Number(localStorage.getItem(HUD_RIGHT_KEY));
    if (Number.isFinite(v) && v >= RIGHT_MIN) return v;
  } catch { /* ignore */ }
  return RIGHT_DEFAULT;
};
const maxRightWidth = (hudWidth: number): number => Math.max(RIGHT_MIN, Math.min(RIGHT_MAX_ABS, hudWidth * 0.4));

export default function Hud() {
  const [tele, setTele] = useState<HostTelemetryView[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => window.cowork.getTelemetry().then((t) => { if (alive) setTele(t); }).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // HUD = QueueRail (session switching) + a 3-pane console (chat / terminal /
  // files) + the telemetry widget deck, over an animated backdrop. The right
  // deck is drag-resizable; the center console flexes to fill what's left.
  const rootRef = useRef<HTMLDivElement>(null);
  const [rightWidth, setRightWidth] = useState(loadRightWidth);
  const [resizing, setResizing] = useState(false);

  // Persist the chosen width.
  useEffect(() => { try { localStorage.setItem(HUD_RIGHT_KEY, String(Math.round(rightWidth))); } catch { /* ignore */ } }, [rightWidth]);

  // Re-clamp whenever the HUD itself resizes (e.g. window shrink / leaving
  // fullscreen) so the right column never exceeds 40% of the available width.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const max = maxRightWidth(el.getBoundingClientRect().width);
      setRightWidth((w) => Math.min(w, max));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag the handle left to widen / right to narrow. Pointer capture keeps the
  // stream flowing even while the cursor passes over the center console iframes.
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const max = maxRightWidth(rootRef.current?.getBoundingClientRect().width ?? window.innerWidth);
    const sx = e.clientX, sw = rightWidth;
    setResizing(true);
    const move = (ev: PointerEvent) => setRightWidth(Math.max(RIGHT_MIN, Math.min(max, sw - (ev.clientX - sx))));
    const up = (ev: PointerEvent) => {
      setResizing(false);
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  const cols = `214px minmax(0,1fr) ${Math.round(rightWidth)}px`;
  return (
    <div ref={rootRef} className="hud-root" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      <HudStyles />
      <span className="hud-grid" />
      <div style={{ position: "relative", zIndex: 1, height: "100%", display: "grid", gridTemplateColumns: cols, minHeight: 0 }}>
        {/* Left column: sessions queue (top half) + Docker status deck (bottom half) */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--border)" }}>
          <div style={{ flex: "1 1 50%", minHeight: 0, display: "flex", flexDirection: "column" }}><QueueRail /></div>
          <div style={{ flex: "1 1 50%", minHeight: 0, display: "flex", flexDirection: "column", padding: "0 10px 10px" }}><DockerDeck /></div>
        </div>
        <HudConsole />
        <div style={{ borderLeft: "1px solid var(--border)", padding: "14px 16px", minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          {/* Drag handle straddling the left border of the telemetry column. */}
          <div
            className={`hud-resize-handle${resizing ? " dragging" : ""}`}
            onPointerDown={startResize}
            onDoubleClick={() => setRightWidth(RIGHT_DEFAULT)}
            title="Drag to resize · double-click to reset"
          />
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
      .hud-resize-handle { position:absolute; top:0; left:-6px; width:12px; height:100%; z-index:6;
        cursor:col-resize; touch-action:none; display:flex; align-items:center; justify-content:center; }
      .hud-resize-handle::before { content:""; width:2px; height:44px; border-radius:2px; background:var(--border-strong);
        transition: background .18s, box-shadow .18s, height .18s; }
      .hud-resize-handle:hover::before, .hud-resize-handle.dragging::before {
        background: rgb(var(--primary-soft) / 0.75); box-shadow: 0 0 10px rgb(var(--primary-soft) / 0.45); height:84px; }
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
