import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { useStore } from "../store";
import { HostTelemetryView } from "../types";
import QueueRail from "./QueueRail";
import MultiTerminal from "./MultiTerminal";
import FilesPanel from "./FilesPanel";
import BrowserPanel from "./BrowserPanel";
import DockerDeck from "./DockerDeck";
import AnswerDock from "./AnswerDock";
import Markdown from "./Markdown";
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
          <div style={{ display: "flex", gap: 14, marginBottom: 11 }}>
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

  const id = focusId;
  const session = sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);
  const transcript = session?.transcript ?? [];
  const pending = id ? pendingMap[id] ?? [] : [];
  const timeline = [...transcript, ...pending.map((p) => ({ role: "user" as const, text: p.text }))];
  const sessionDecisions = decisions.filter((d) => d.sessionId === id);
  const actionable = sessionDecisions.find((d) => ACTIONABLE.includes(d.kind));
  const decision = actionable ?? sessionDecisions[0];
  const isWorking = !!session && session.status !== "lost" && !actionable && (!!session.working || pending.length > 0);

  useEffect(() => {
    if (scrollRef.current && stick.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.transcript, pending.length, isWorking]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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

type PanelKey = "chat" | "term" | "files" | "browser";
type ConsoleView = "ctf" | "cb" | "ctb" | "fb";

/**
 * Layout catalog. Every view is a CSS-grid arrangement of the SAME four panel
 * instances — a view only reassigns each panel's grid-area (or hides it). Because
 * the panels never leave the grid, switching views never remounts them, so shells,
 * pages and editors keep their state. `areas` maps a panel → its grid-area name
 * (absent = hidden in that view).
 */
const VIEWS: Record<ConsoleView, { label: string; cols: string; rows: string; template: string; areas: Partial<Record<PanelKey, string>> }> = {
  ctf: { label: "Chat · Term · Files", cols: "1fr", rows: "1.4fr 1fr 1.1fr", template: `"chat" "term" "files"`, areas: { chat: "chat", term: "term", files: "files" } },
  cb: { label: "Chat · Browser", cols: "1fr 1.3fr", rows: "1fr", template: `"chat browser"`, areas: { chat: "chat", browser: "browser" } },
  ctb: { label: "Chat · Term · Browser", cols: "1fr 1.2fr", rows: "1.2fr 1fr", template: `"chat browser" "term browser"`, areas: { chat: "chat", term: "term", browser: "browser" } },
  fb: { label: "Files · Browser", cols: "1fr 1.2fr", rows: "1fr", template: `"files browser"`, areas: { files: "files", browser: "browser" } },
};
const VIEW_ORDER: ConsoleView[] = ["ctf", "cb", "ctb", "fb"];

/** A titled grid-positioned panel wrapper. Stays mounted; hidden via display:none. */
function GridPanel({ title, area, children }: { title: string; area?: string; children: React.ReactNode }) {
  const shown = !!area;
  return (
    <div style={{ ...card, padding: 0, gridArea: area, display: shown ? "flex" : "none", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      <div style={{ padding: "7px 13px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Decode text={title} className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

/**
 * The HUD center. A view switcher picks one of four grid layouts; all four panels
 * (Chat, Terminal, Files, Browser) stay mounted so switching never reloads them.
 */
function HudConsole() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const [view, setView] = useState<ConsoleView>("ctf");
  const cfg = VIEWS[view];
  const none = <div className="mono faint" style={{ padding: 14, fontSize: 11 }}>no session</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, padding: "12px 14px" }}>
      {/* header: identity + view switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        {session && (
          <>
            <span className="display" style={{ fontSize: 16 }}>{projectName(session.cwd)}</span>
            <span className="mono faint" style={{ fontSize: 10 }}>{session.machine} · {session.gitBranch ?? "no-branch"}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 999, border: "1px solid var(--border)" }}>
          {VIEW_ORDER.map((v) => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "5px 11px", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 10.5, cursor: "pointer", border: 0, whiteSpace: "nowrap",
              background: view === v ? "rgb(var(--primary) / 0.28)" : "transparent", color: view === v ? "#fff" : "var(--text-soft)",
            }}>{VIEWS[v].label}</button>
          ))}
        </div>
      </div>

      {/* grid body — the four panels are always mounted; area/visibility per view */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gap: 10, gridTemplateColumns: cfg.cols, gridTemplateRows: cfg.rows, gridTemplateAreas: cfg.template }}>
        <GridPanel title="Chat" area={cfg.areas.chat}><ChatPane /></GridPanel>
        <GridPanel title="Terminal" area={cfg.areas.term}>
          {session ? <MultiTerminal key={`${session.id}-hud-term`} sessionId={session.id} cwd={session.cwd} machine={session.machine} /> : none}
        </GridPanel>
        <GridPanel title="Files" area={cfg.areas.files}>
          {session ? <FilesPanel key={`${session.id}-hud-files`} sessionId={session.id} cwd={session.cwd} machine={session.machine} /> : none}
        </GridPanel>
        <GridPanel title="Browser" area={cfg.areas.browser}>
          {session ? <BrowserPanel key={`${session.id}-hud-browser`} sessionId={session.id} cwd={session.cwd} machine={session.machine} /> : none}
        </GridPanel>
      </div>
    </div>
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

  // HUD = QueueRail (session switching) + a 3-pane console (chat / terminal /
  // files) + the telemetry widget deck, over an animated backdrop. The deck can
  // expand to reclaim space for more widgets.
  const [wide, setWide] = useState(true);
  const cols = wide ? "214px minmax(360px,1fr) 560px" : "214px minmax(0,1fr) 372px";
  return (
    <div className="hud-root" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
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
