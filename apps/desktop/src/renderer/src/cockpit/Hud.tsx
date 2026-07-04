import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { useStore } from "../store";
import { HostTelemetryView } from "../types";
import QueueRail from "./QueueRail";
import TerminalStack from "./TerminalStack";
import FilesPanel from "./FilesPanel";
import BrowserStack from "./BrowserStack";
import DockerLogPanel from "./DockerLogPanel";
import NotesPanel from "./NotesPanel";
import PortsPanel from "./PortsPanel";
import CustomAppPanel, { type CustomApp } from "./CustomAppPanel";
import AppsModal, { AppIcon } from "./AppsModal";
import ContextColumn from "./ContextColumn";
import AnswerDock from "./AnswerDock";
import Markdown from "./Markdown";
import ContextGauge from "./ContextGauge";
import ModeSelect from "./ModeSelect";
import TokenSpendWidget from "./TokenSpendWidget";
import SessionInfoWidget from "./SessionInfoWidget";
import { GitInfo } from "../types";
import { useAppearance, type DockPos } from "../appearance";

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
  const openUrlInBrowser = useStore((s) => s.openUrlInBrowser);
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
          <span className="mono faint" title={info.branch}
            style={{ fontSize: 9.5, color: "rgb(var(--primary-soft))", minWidth: 0, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {info.branch}
          </span>
        )}
        {info?.webUrl && session && (
          <button
            onClick={() => openUrlInBrowser(session.id, info.webUrl!)}
            title={`Open ${info.webUrl} in this session's browser`}
            style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "1px 7px", fontSize: 10, cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <span style={{ fontSize: 11, lineHeight: 1 }}>⎇</span>GitHub
          </button>
        )}
        <button onClick={load} title="Refresh" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "1px 7px", fontSize: 10, cursor: "pointer", flexShrink: 0 }}>↻</button>
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
    const total = sessions.length;
    const spent = sessions.reduce((n, s) => n + (s.attachedAt ? Date.now() - new Date(s.attachedAt).getTime() : 0), 0);
    return { active, waiting, total, spent };
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
            {metric("Sessions", String(fleet.total))}
            {metric("Uptime", fmtDur(fleet.spent))}
          </div>
          <WaveLine height={30} color="rgb(var(--accent))" />
        </motion.div>
      </div>

      {/* Session-scoped uplink: host IPs + time-on-session + prompt count */}
      <motion.div variants={RISE}><SessionInfoWidget /></motion.div>

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
type FixedKey = "chat" | "term" | "files" | "browser" | "tasks" | "notes" | "ports";
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
  { key: "ports", title: "Ports", icon: "⇄" },
];
const GRID_PANELS: GridKey[] = ["chat", "term", "files", "browser"];
const isDockerId = (id: string): boolean => id.startsWith("docker:");
const isAppId = (id: string): boolean => id.startsWith("app:");
const appWinId = (appId: string): string => `app:${appId}`;

// Custom apps are a user-global list (persisted); their WINDOW geometry is stored
// per-session like every other window. A newly-opened app window gets this size.
const DEFAULT_APP_WIN: WinState = { x: 90, y: 66, w: 940, h: 640, min: false };
const APPS_KEY = "rcw.customApps";
function loadApps(): CustomApp[] {
  try {
    const raw = localStorage.getItem(APPS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((a) => a && typeof a.id === "string" && typeof a.url === "string") : [];
  } catch {
    return [];
  }
}

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
      ports: { x: 150, y: 90, w: 560, h: 460, min: true },
    },
    dockerIds: [],
    z: ["chat", "term", "files", "browser", "tasks", "notes", "ports"],
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

/** Validate one persisted WinMap, backfilling any missing fixed windows. */
function sanitizeWinMap(p: Partial<WinMap> | undefined): WinMap {
  const base = defaultWins();
  if (!p || !p.wins || typeof p.wins !== "object") return base;
  const wins: Record<string, WinState> = { ...base.wins, ...p.wins };
  const dockerIds = Array.isArray(p.dockerIds)
    ? p.dockerIds.filter((id): id is string => typeof id === "string" && !!wins[id])
    : [];
  const allIds = [...FIXED.map((f) => f.key), ...dockerIds];
  const z = (Array.isArray(p.z) ? p.z.filter((id) => allIds.includes(id)) : []) as string[];
  for (const id of allIds) if (!z.includes(id)) z.push(id);
  return { wins, dockerIds, z, seq: typeof p.seq === "number" ? p.seq : 0, _init: p._init ?? false };
}

// The console arrangement is stored PER SESSION so each session remembers its own
// grid view, grid/windows mode, and floating-window layout. Keyed by session id
// (or "__none__" when nothing is focused) and persisted as a whole map.
type SessionConsole = { view: ConsoleView; layout: HudLayout; win: WinMap };
const CONSOLE_KEY = "rcw.hud.console.v1";
const NO_SESSION = "__none__";
function defaultConsole(): SessionConsole {
  return { view: "ctf", layout: "grid", win: defaultWins() };
}

// Named, reusable window-layout templates (a saved SessionConsole snapshot), shared
// across sessions and persisted so they survive restarts.
const TEMPLATES_KEY = "rcw.hud.templates.v1";
function loadTemplates(): Record<string, SessionConsole> {
  try {
    const p = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}
const cloneConsole = (c: SessionConsole): SessionConsole => JSON.parse(JSON.stringify(c));
function loadConsoles(): Record<string, SessionConsole> {
  try {
    const raw = localStorage.getItem(CONSOLE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, Partial<SessionConsole>>;
    const out: Record<string, SessionConsole> = {};
    for (const [k, v] of Object.entries(p)) {
      out[k] = {
        view: (v.view as ConsoleView) ?? "ctf",
        layout: (v.layout as HudLayout) ?? "grid",
        win: sanitizeWinMap(v.win as Partial<WinMap> | undefined),
      };
    }
    return out;
  } catch {
    return {};
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
  const openUrlInBrowser = useStore((s) => s.openUrlInBrowser);
  const pendingBrowserOpen = useStore((s) => s.pendingBrowserOpen);
  const appr = useAppearance();
  const dockPos = appr.dockPos;
  const dockScale = appr.dockScale;
  const canvasRef = useRef<HTMLDivElement>(null);
  const none = <div className="mono faint" style={{ padding: 14, fontSize: 11 }}>no session</div>;
  const [dockerMenu, setDockerMenu] = useState(false); // Docker dock icon right-click menu
  // Saved window-layout templates + the save/load menu.
  const [templates, setTemplates] = useState<Record<string, SessionConsole>>(loadTemplates);
  useEffect(() => { try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); } catch { /* ignore */ } }, [templates]);
  const [tplMenu, setTplMenu] = useState(false);
  const [tplName, setTplName] = useState("");
  // Custom apps: a user-global list (persisted); window geometry is per session.
  const [apps, setApps] = useState<CustomApp[]>(loadApps);
  useEffect(() => { try { localStorage.setItem(APPS_KEY, JSON.stringify(apps)); } catch { /* ignore */ } }, [apps]);
  const [appsModal, setAppsModal] = useState(false);

  // Per-session console state: each session keeps its own view / grid-vs-windows /
  // floating-window layout. Setters target the CURRENT session via a ref, so they
  // stay correct inside long-lived effects even after the focus changes.
  const focusKey = focusId ?? NO_SESSION;
  const focusKeyRef = useRef(focusKey);
  focusKeyRef.current = focusKey;
  const [consoles, setConsoles] = useState<Record<string, SessionConsole>>(loadConsoles);
  useEffect(() => { try { localStorage.setItem(CONSOLE_KEY, JSON.stringify(consoles)); } catch { /* ignore */ } }, [consoles]);

  const cur = consoles[focusKey] ?? defaultConsole();
  const view = cur.view;
  const layout = cur.layout;
  const wins = cur.win;
  const cfg = VIEWS[view];

  const setView = (v: ConsoleView) =>
    setConsoles((all) => { const k = focusKeyRef.current; const c = all[k] ?? defaultConsole(); return { ...all, [k]: { ...c, view: v } }; });
  const setLayout = (l: HudLayout) =>
    setConsoles((all) => { const k = focusKeyRef.current; const c = all[k] ?? defaultConsole(); return { ...all, [k]: { ...c, layout: l } }; });
  const setWins = (updater: WinMap | ((w: WinMap) => WinMap)) =>
    setConsoles((all) => {
      const k = focusKeyRef.current;
      const c = all[k] ?? defaultConsole();
      const next = typeof updater === "function" ? (updater as (w: WinMap) => WinMap)(c.win) : updater;
      return next === c.win ? all : { ...all, [k]: { ...c, win: next } };
    });

  // On session switch, clamp the newly-focused session's windows to the canvas so a
  // layout saved at a different size can't leave a window off-screen.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setWins((w) => {
      let changed = false;
      const nextWins = { ...w.wins };
      for (const id of Object.keys(w.wins)) {
        const c = clampWin(w.wins[id], rect.width, rect.height);
        const p = w.wins[id];
        if (c.x !== p.x || c.y !== p.y || c.w !== p.w || c.h !== p.h) { nextWins[id] = c; changed = true; }
      }
      return changed ? { ...w, wins: nextWins } : w;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Layout templates: snapshot the current session's console, or apply a saved one
  // to it. Applying switches to Windows mode if the template is a windows layout.
  const saveTemplate = () => {
    const name = tplName.trim();
    if (!name) return;
    setTemplates((t) => ({ ...t, [name]: cloneConsole(cur) }));
    setTplName("");
  };
  const applyTemplate = (name: string) => {
    const tpl = templates[name];
    if (!tpl) return;
    const k = focusKeyRef.current;
    setConsoles((all) => ({ ...all, [k]: cloneConsole(tpl) }));
    setTplMenu(false);
  };
  const deleteTemplate = (name: string) => setTemplates((t) => { const n = { ...t }; delete n[name]; return n; });

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

  // Auto-start the focused session's configured port forwards in HUD mode — the
  // Ports panel does this on mount, but in HUD it may never be opened, so do it
  // here whenever a (remote) session is focused. startForward is idempotent.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        if (await window.cowork.isLocalMachine(session.machine)) return;
        const cfg = await window.cowork.getWorkspaceConfig({ sessionId: session.id, cwd: session.cwd, machine: session.machine });
        if (cancelled || !cfg) return;
        for (const p of cfg.forwardPorts ?? []) {
          window.cowork.startForward({ sessionId: session.id, machine: session.machine, port: p }).catch(() => { /* ignore */ });
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [session?.id, session?.cwd, session?.machine]);

  const raise = (id: string) => setWins((w) => (w.z[w.z.length - 1] === id ? w : { ...w, z: [...w.z.filter((k) => k !== id), id] }));
  const patchWin = (id: string, patch: Partial<WinState>) =>
    setWins((w) => ({ ...w, wins: { ...w.wins, [id]: { ...w.wins[id], ...patch } } }));

  // Bring the in-app browser into view: in grid, switch to a browser-bearing view;
  // in windows, un-minimize the browser window and raise it to the front.
  const revealBrowser = () => {
    if (layout === "grid") {
      if (!VIEWS[view].areas.browser) setView("cb");
    } else {
      setWins((w) => ({ ...w, wins: { ...w.wins, browser: { ...w.wins.browser, min: false } }, z: [...w.z.filter((k) => k !== "browser"), "browser"] }));
    }
  };

  // When a URL is opened in the focused session's browser (git widget's GitHub
  // link, or a custom app's cross-domain link), reveal the browser window/view.
  // Fires once per request (nonce-guarded); background opens for other sessions
  // don't steal the current view.
  const revealNonce = useRef(0);
  useEffect(() => {
    const p = pendingBrowserOpen;
    if (!p || p.nonce === revealNonce.current) return;
    revealNonce.current = p.nonce;
    if (p.sessionId === focusKeyRef.current) revealBrowser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBrowserOpen]);

  // A custom app tried to navigate to another domain — the main process cancelled
  // the in-app navigation and asks us to open it in this session's workspace
  // browser instead (never the OS browser). Fall back to the OS browser only if no
  // session is focused to receive it.
  useEffect(() => {
    const off = window.cowork.onOpenInWorkspaceBrowser((a) => {
      const sid = focusKeyRef.current;
      if (a?.url && sid && sid !== NO_SESSION) openUrlInBrowser(sid, a.url);
      else if (a?.url) window.cowork.openExternal(a.url).catch(() => {});
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUrlInBrowser]);

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

  // Spawn a new Docker Log window. Each gets a unique id so several can tail
  // different containers at once. Reached only via the Docker dock icon's
  // right-click menu ("New window").
  const createDocker = () => {
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
  // The single Docker dock icon behaves like a normal app: left-click focuses /
  // minimizes / restores the frontmost Docker window (creating one if none exist).
  // A NEW window is only made via the right-click menu.
  const dockClickDocker = () => {
    if (wins.dockerIds.length === 0) { createDocker(); return; }
    setWins((w) => {
      const primary = [...w.z].reverse().find((id) => w.dockerIds.includes(id));
      if (!primary) return w;
      const c = w.wins[primary];
      const front = w.z[w.z.length - 1];
      if (c.min) return { ...w, wins: { ...w.wins, [primary]: { ...c, min: false } }, z: [...w.z.filter((k) => k !== primary), primary] };
      if (front === primary) return { ...w, wins: { ...w.wins, [primary]: { ...c, min: true } } };
      return { ...w, z: [...w.z.filter((k) => k !== primary), primary] };
    });
  };

  // Custom apps: open/focus/minimize a window (create its geometry on first open),
  // remove an app entirely (dropping its window from every session), and adopt a
  // captured favicon when the user didn't pick an icon.
  const openApp = (appId: string) => {
    const wid = appWinId(appId);
    setLayout("windows");
    setWins((w) => {
      const cur = w.wins[wid];
      const front = w.z[w.z.length - 1];
      if (!cur) {
        const rect = canvasRef.current?.getBoundingClientRect();
        let ws = { ...DEFAULT_APP_WIN };
        if (rect && rect.width > 0 && rect.height > 0) ws = clampWin(ws, rect.width, rect.height);
        return { ...w, wins: { ...w.wins, [wid]: ws }, z: [...w.z.filter((k) => k !== wid), wid] };
      }
      if (cur.min) return { ...w, wins: { ...w.wins, [wid]: { ...cur, min: false } }, z: [...w.z.filter((k) => k !== wid), wid] };
      if (front === wid) return { ...w, wins: { ...w.wins, [wid]: { ...cur, min: true } } };
      return { ...w, z: [...w.z.filter((k) => k !== wid), wid] };
    });
  };
  const closeAppWindow = (wid: string) => setWins((w) => {
    const nextWins = { ...w.wins };
    delete nextWins[wid];
    return { ...w, wins: nextWins, z: w.z.filter((k) => k !== wid) };
  });
  const addApp = (app: CustomApp) => setApps((a) => [...a, app]);
  const removeApp = (appId: string) => {
    setApps((a) => a.filter((x) => x.id !== appId));
    const wid = appWinId(appId);
    setConsoles((all) => {
      const out: Record<string, SessionConsole> = {};
      for (const [k, c] of Object.entries(all)) {
        if (!c.win.wins[wid] && !c.win.z.includes(wid)) { out[k] = c; continue; }
        const nw = { ...c.win.wins };
        delete nw[wid];
        out[k] = { ...c, win: { ...c.win, wins: nw, z: c.win.z.filter((z) => z !== wid) } };
      }
      return out;
    });
  };
  const setAppFavicon = useCallback((appId: string, url: string) =>
    setApps((a) => a.map((x) => (x.id === appId && !x.icon ? { ...x, icon: url } : x))), []);

  // A "workspace" is the focused session's project (machine + cwd). Apps flagged
  // "this workspace only" are shown only when that workspace is focused.
  const workspaceKey = session ? `${session.machine}:${session.cwd}` : null;
  const workspaceName = session ? projectName(session.cwd) : null;
  const appVisible = (a: CustomApp): boolean => !a.workspace || a.workspace === workspaceKey;

  const childFor = (id: string): React.ReactNode => {
    switch (id) {
      case "chat": return <ChatPane />;
      case "term": return <TerminalStack activeId={session?.id} active={termActive} />;
      case "files": return session ? <FilesPanel key={`${session.id}-hud-files`} sessionId={session.id} cwd={session.cwd} machine={session.machine} /> : none;
      case "browser": return <BrowserStack activeId={session?.id} active={browserActive} />;
      case "tasks": return <ContextColumn sessionId={session?.id} hideSummary />;
      case "notes": return <NotesPanel active={!grid && !wins.wins.notes?.min} />;
      case "ports": return session ? <PortsPanel key={`${session.id}-hud-ports`} sessionId={session.id} cwd={session.cwd} machine={session.machine} /> : none;
      default:
        if (isDockerId(id)) return <DockerLogPanel streamId={id} active={!grid && !wins.wins[id]?.min} />;
        if (isAppId(id)) { const app = apps.find((a) => appWinId(a.id) === id); return app ? <CustomAppPanel app={app} onFavicon={setAppFavicon} /> : null; }
        return null;
    }
  };

  // All windows to render: fixed singletons + dynamic Docker Log windows + open
  // custom-app windows (only those with geometry for this session). Grid areas
  // apply only to the four grid panels; everything else is windows-mode only.
  const windowList: { id: string; title: string; area?: string; onClose?: () => void }[] = [
    ...FIXED.map((f) => ({
      id: f.key,
      title: f.title,
      area: (GRID_PANELS as string[]).includes(f.key) ? cfg.areas[f.key as GridKey] : undefined,
    })),
    ...wins.dockerIds.map((id, i) => ({ id, title: `Docker ${i + 1}`, onClose: () => closeDocker(id) })),
    ...apps
      .filter((a) => appVisible(a) && !!wins.wins[appWinId(a.id)])
      .map((a) => ({ id: appWinId(a.id), title: a.name, onClose: () => closeAppWindow(appWinId(a.id)) })),
  ];
  // Dock entries: just the fixed apps. Docker gets ONE dedicated icon (below) with
  // a right-click menu to manage its (possibly several) windows.
  const dockItems = FIXED.map((f) => ({ id: f.key, title: f.title, icon: f.icon }));
  const anyDockerOpen = wins.dockerIds.some((id) => !wins.wins[id]?.min);
  const dockerFront = wins.dockerIds.length > 0 && wins.dockerIds.includes(wins.z[wins.z.length - 1]);

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

        {/* Layout templates: save the current arrangement / apply a saved one. */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setTplMenu((m) => !m)} title="Save / load a window layout"
            style={{
              padding: "5px 11px", borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: 10.5, cursor: "pointer", whiteSpace: "nowrap",
              border: "1px solid var(--border)", background: tplMenu ? "rgb(var(--primary) / 0.22)" : "transparent", color: "var(--text-soft)",
            }}>▤ Layouts</button>
          {tplMenu && (
            <>
              <div onClick={() => setTplMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 1500 }} />
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 1600, width: 230, padding: 8, borderRadius: 12,
                border: "1px solid var(--border-strong)", boxShadow: "0 12px 40px rgb(0 0 0 / 0.5)", ...WIN_GLASS,
              }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTemplate(); }}
                    placeholder="Template name…"
                    style={{ flex: 1, minWidth: 0, border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)", color: "var(--text)", borderRadius: 7, padding: "5px 8px", fontSize: 11.5, outline: "none", fontFamily: "var(--font-mono)" }}
                  />
                  <button onClick={saveTemplate} disabled={!tplName.trim()} title="Save current layout"
                    className="glass-btn--clay" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, opacity: tplName.trim() ? 1 : 0.5 }}>Save</button>
                </div>
                <div style={{ height: 1, background: "var(--border)", margin: "2px 0 6px" }} />
                {Object.keys(templates).length === 0 ? (
                  <div className="mono faint" style={{ fontSize: 10.5, padding: "4px 4px" }}>No saved layouts yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 240, overflowY: "auto" }} className="no-scrollbar">
                    {Object.keys(templates).sort().map((name) => (
                      <div key={name} className="hud-rail-row" style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 7 }}>
                        <span onClick={() => applyTemplate(name)} title="Apply this layout"
                          style={{ flex: 1, minWidth: 0, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                        <span className="mono faint" style={{ fontSize: 9 }}>{templates[name].layout === "windows" ? "win" : "grid"}</span>
                        <span onClick={() => deleteTemplate(name)} title="Delete" style={{ cursor: "pointer", color: "var(--text-faint)", fontSize: 12 }}>✕</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
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
            onClose={p.onClose}
          >
            {childFor(p.id)}
          </PanelShell>
        ))}

        {/* macOS-style app dock — the single place to restore / focus windows. */}
        {!grid && (
          <div style={{ ...WIN_GLASS, ...dockContainerStyle(dockPos, dockScale) }}>
            <span className="hud-corner" />
            {dockItems.map((p) => {
              const open = !wins.wins[p.id]?.min;
              const front = open && wins.z[wins.z.length - 1] === p.id;
              return (
                <button key={p.id} onClick={() => dockClick(p.id)}
                  title={open ? (front ? `${p.title} (click to minimize)` : `Focus ${p.title}`) : `Restore ${p.title}`}
                  style={dockBtnStyle(open, front)}>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{p.icon}</span>
                  <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>{p.title}</span>
                  <span style={{ width: 4, height: 4, borderRadius: 999, marginTop: 1, background: open ? "rgb(var(--accent))" : "transparent" }} className={front ? "hud-pulse" : undefined} />
                </button>
              );
            })}
            {/* Single Docker app icon: left-click focuses/minimizes; right-click opens
                a menu to create a new window or jump to an existing one. */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => { setDockerMenu(false); dockClickDocker(); }}
                onContextMenu={(e) => { e.preventDefault(); setDockerMenu((m) => !m); }}
                title="Docker logs — click to focus/minimize · right-click for options"
                style={dockBtnStyle(anyDockerOpen, dockerFront)}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>🐳</span>
                <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Docker{wins.dockerIds.length > 1 ? ` ·${wins.dockerIds.length}` : ""}
                </span>
                <span style={{ width: 4, height: 4, borderRadius: 999, marginTop: 1, background: anyDockerOpen ? "rgb(var(--accent))" : "transparent" }} className={dockerFront ? "hud-pulse" : undefined} />
              </button>
              {dockerMenu && (
                <>
                  {/* click-away backdrop */}
                  <div onClick={() => setDockerMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 1500 }} />
                  <div style={{
                    ...dockMenuAnchor(dockPos), zIndex: 1600,
                    minWidth: 190, padding: 5, borderRadius: 12, border: "1px solid var(--border-strong)",
                    boxShadow: "0 12px 40px rgb(0 0 0 / 0.5)", ...WIN_GLASS,
                  }}>
                    <button onClick={() => { createDocker(); setDockerMenu(false); }}
                      style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: 0, background: "transparent", color: "var(--text)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                      <span style={{ color: "rgb(var(--accent))" }}>＋</span> New Docker window
                    </button>
                    {wins.dockerIds.length > 0 && <div style={{ height: 1, background: "var(--border)", margin: "4px 2px" }} />}
                    {wins.dockerIds.map((id, i) => (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 8 }} className="hud-rail-row">
                        <span onClick={() => { dockClick(id); setDockerMenu(false); }}
                          style={{ flex: 1, minWidth: 0, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, color: wins.wins[id]?.min ? "var(--text-soft)" : "var(--text)" }}>
                          🐳 Docker {i + 1}{wins.wins[id]?.min ? " (minimized)" : ""}
                        </span>
                        <span onClick={() => closeDocker(id)} title="Close window"
                          style={{ cursor: "pointer", color: "var(--text-faint)", fontSize: 12 }}>✕</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Custom app icons + an "＋ App" launcher (add / manage). */}
            {apps.filter(appVisible).map((a) => {
              const wid = appWinId(a.id);
              const open = !!wins.wins[wid] && !wins.wins[wid].min;
              const front = open && wins.z[wins.z.length - 1] === wid;
              return (
                <button key={a.id} onClick={() => openApp(a.id)}
                  onContextMenu={(e) => { e.preventDefault(); setAppsModal(true); }}
                  title={`${a.name} — click to open · right-click to manage`}
                  style={dockBtnStyle(open, front)}>
                  <span style={{ height: 15, display: "grid", placeItems: "center" }}><AppIcon icon={a.icon} size={16} /></span>
                  <span style={{ fontSize: 8, letterSpacing: "0.06em", textTransform: "uppercase", maxWidth: 44, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                  <span style={{ width: 4, height: 4, borderRadius: 999, marginTop: 1, background: open ? "rgb(var(--accent))" : "transparent" }} className={front ? "hud-pulse" : undefined} />
                </button>
              );
            })}
            <button onClick={() => setAppsModal(true)} title="Add or manage custom apps"
              style={{ ...dockBtnStyle(false, false), border: "1px dashed var(--border-strong)" }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>➕</span>
              <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>App</span>
              <span style={{ width: 4, height: 4, marginTop: 1 }} />
            </button>
          </div>
        )}
      </div>

      {appsModal && (
        <AppsModal apps={apps} workspaceKey={workspaceKey} workspaceName={workspaceName} onAdd={addApp} onRemove={removeApp} onClose={() => setAppsModal(false)} />
      )}
    </div>
  );
}

/** Where the HUD dock sits on the canvas — anchored per the user's Appearance pref.
 * `scale` grows/shrinks the whole dock via `zoom` (Chromium scales layout + hit
 * area, and it composes cleanly with the translate-based centering). */
function dockContainerStyle(pos: DockPos, scale = 1): React.CSSProperties {
  const vertical = pos === "left" || pos === "right";
  const base: React.CSSProperties = {
    position: "absolute", zIndex: 1000, display: "flex", gap: 6, padding: "8px 10px 6px",
    borderRadius: 18, border: "1px solid var(--border-strong)", boxShadow: "0 12px 40px rgb(0 0 0 / 0.5)",
    flexDirection: vertical ? "column" : "row", alignItems: vertical ? "center" : "flex-end",
    zoom: scale !== 1 ? scale : undefined,
  };
  switch (pos) {
    case "top": return { ...base, top: 14, left: "50%", transform: "translateX(-50%)" };
    case "bottom-left": return { ...base, bottom: 14, left: 14 };
    case "bottom-right": return { ...base, bottom: 14, right: 14 };
    case "left": return { ...base, left: 14, top: "50%", transform: "translateY(-50%)" };
    case "right": return { ...base, right: 14, top: "50%", transform: "translateY(-50%)" };
    case "bottom":
    default: return { ...base, bottom: 14, left: "50%", transform: "translateX(-50%)" };
  }
}

/** Anchor a dock icon's popover so it opens toward the canvas interior. */
function dockMenuAnchor(pos: DockPos): React.CSSProperties {
  if (pos === "top") return { position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" };
  if (pos === "left") return { position: "absolute", left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" };
  if (pos === "right") return { position: "absolute", right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" };
  return { position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" };
}

/** Shared dock-button style: highlighted when frontmost, dimmed when minimized. */
function dockBtnStyle(open: boolean, front: boolean): React.CSSProperties {
  return {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 46, padding: "6px 0 3px",
    borderRadius: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
    border: front ? "1px solid rgb(var(--accent) / 0.55)" : "1px solid transparent",
    background: front ? "rgb(var(--primary) / 0.22)" : open ? "rgb(var(--primary) / 0.10)" : "transparent",
    color: open ? "var(--text)" : "var(--text-soft)", opacity: open ? 1 : 0.6,
    transition: "background .18s, opacity .18s, border-color .18s",
  };
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
        {/* Left column: sessions queue (top half) + git history (bottom half) */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--border)" }}>
          <div style={{ flex: "1 1 50%", minHeight: 0, display: "flex", flexDirection: "column" }}><QueueRail /></div>
          <div className="no-scrollbar" style={{ flex: "1 1 50%", minHeight: 0, overflowY: "auto", padding: "0 10px 10px" }}><GitPane /></div>
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
