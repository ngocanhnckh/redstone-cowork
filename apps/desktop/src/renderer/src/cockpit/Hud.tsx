import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { HostTelemetryView, SessionView } from "../types";

// ---- formatting helpers ----
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

// ---- primitives ----
function Sparkline({ data, max, height = 34, color = "rgb(var(--primary-soft))" }: { data: number[]; max?: number; height?: number; color?: string }) {
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
          <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

function Bar({ pct, color = "rgb(var(--primary-soft))" }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 999, transition: "width 0.6s ease" }} />
    </div>
  );
}

/** Equirectangular mini-map with a pulsing dot at the host's location. */
function MiniGlobe({ geo }: { geo: { lat: number; long: number; city: string | null } | null }) {
  const W = 150, H = 78;
  const x = geo ? ((geo.long + 180) / 360) * W : null;
  const y = geo ? ((90 - geo.lat) / 180) * H : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 78, display: "block", borderRadius: 8, background: "rgb(var(--primary) / 0.05)", border: "1px solid var(--border)" }}>
        {/* graticule */}
        {[0.25, 0.5, 0.75].map((f) => <line key={`h${f}`} x1={0} y1={H * f} x2={W} y2={H * f} stroke="var(--border-strong)" strokeWidth={0.4} opacity={0.5} />)}
        {[0.2, 0.4, 0.6, 0.8].map((f) => <line key={`v${f}`} x1={W * f} y1={0} x2={W * f} y2={H} stroke="var(--border-strong)" strokeWidth={0.4} opacity={0.5} />)}
        {x != null && y != null && (
          <>
            <circle cx={x} cy={y} r={7} fill="none" stroke="rgb(var(--accent))" strokeWidth={0.8} opacity={0.6}><animate attributeName="r" values="3;9;3" dur="2.4s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.7;0;0.7" dur="2.4s" repeatCount="indefinite" /></circle>
            <circle cx={x} cy={y} r={2.4} fill="rgb(var(--accent))" />
            <line x1={x} y1={0} x2={x} y2={H} stroke="rgb(var(--accent))" strokeWidth={0.4} opacity={0.35} />
            <line x1={0} y1={y} x2={W} y2={y} stroke="rgb(var(--accent))" strokeWidth={0.4} opacity={0.35} />
          </>
        )}
      </svg>
      <div className="mono faint" style={{ fontSize: 10, marginTop: 5 }}>
        {geo ? `${geo.city ?? "unknown"} · ${geo.lat.toFixed(2)}, ${geo.long.toFixed(2)}` : "location unavailable"}
      </div>
    </div>
  );
}

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", background: "rgb(var(--primary) / 0.03)" };
const kicker = (t: string) => <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)", marginBottom: 10 }}>{t}</div>;
const metric = (label: string, value: string) => (
  <div><div className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div><div style={{ fontSize: 15, fontFamily: "var(--font-mono)" }}>{value}</div></div>
);

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const hh = now.toLocaleTimeString(undefined, { hour12: false });
  const dd = now.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  return (
    <div style={card}>
      {kicker("Mission Time")}
      <div className="display" style={{ fontSize: 40, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{hh}</div>
      <div className="mono faint" style={{ fontSize: 11, marginTop: 6 }}>{dd} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
    </div>
  );
}

function HostCard({ t }: { t: HostTelemetryView }) {
  const ramPct = t.latest.ramTotal > 0 ? (t.latest.ramUsed / t.latest.ramTotal) * 100 : 0;
  return (
    <div style={card}>
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

function sessionMetrics(s: SessionView) {
  const prompts = (s.transcript ?? []).filter((m) => m.role === "user").length;
  const allTodos = [
    ...(s.todos ?? []).map((t) => t.status === "completed"),
    ...(s.userTodos ?? []).map((t) => t.done),
  ];
  const done = allTodos.filter(Boolean).length;
  const spentMs = s.attachedAt ? Date.now() - new Date(s.attachedAt).getTime() : 0;
  return { prompts, todosDone: done, todosTotal: allTodos.length, spentMs };
}
const fmtDur = (ms: number): string => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

function SessionCard({ s }: { s: SessionView }) {
  const m = sessionMetrics(s);
  const folder = s.cwd.split("/").filter(Boolean).pop() ?? s.cwd;
  const waiting = s.status === "waiting";
  return (
    <div style={{ ...card, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: waiting ? "rgb(var(--accent))" : s.working ? "rgb(var(--primary-soft))" : "var(--border-strong)", boxShadow: waiting ? "0 0 0 3px rgb(var(--accent) / 0.18)" : "none" }} />
        <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder}</span>
        <span style={{ flex: 1 }} />
        <span className="mono faint" style={{ fontSize: 9.5 }}>{s.machine}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {metric("Prompts", String(m.prompts))}
        {metric("Time", fmtDur(m.spentMs))}
        {metric("Todos", m.todosTotal ? `${m.todosDone}/${m.todosTotal}` : "—")}
        {metric("Seen", timeAgo(s.lastSeenAt))}
        {metric("Mode", s.permissionMode ?? "default")}
        {metric("Status", waiting ? "waiting" : s.working ? "working" : s.status)}
      </div>
    </div>
  );
}

export default function Hud() {
  const sessions = useStore((s) => s.sessions);
  const [tele, setTele] = useState<HostTelemetryView[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => window.cowork.getTelemetry().then((t) => { if (alive) setTele(t); }).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const fleet = useMemo(() => {
    const active = sessions.filter((s) => s.status === "active" || s.working).length;
    const waiting = sessions.filter((s) => s.status === "waiting").length;
    const prompts = sessions.reduce((n, s) => n + (s.transcript ?? []).filter((m) => m.role === "user").length, 0);
    const spent = sessions.reduce((n, s) => n + (s.attachedAt ? Date.now() - new Date(s.attachedAt).getTime() : 0), 0);
    return { total: sessions.length, active, waiting, prompts, spent };
  }, [sessions]);

  return (
    <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top row: clock + fleet summary */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
        <Clock />
        <div style={card}>
          {kicker("Fleet")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {metric("Sessions", String(fleet.total))}
            {metric("Active", String(fleet.active))}
            {metric("Waiting", String(fleet.waiting))}
            {metric("Hosts", String(tele.length))}
            {metric("Prompts", String(fleet.prompts))}
            {metric("Total time", fmtDur(fleet.spent))}
          </div>
        </div>
      </div>

      {/* Host telemetry */}
      <div>
        <div className="kicker" style={{ marginBottom: 8 }}>Hosts</div>
        {tele.length === 0 ? (
          <div className="soft" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 540 }}>
            No live telemetry yet. Run <span className="mono">redstone agent</span> on a host to stream CPU / RAM / network / location here.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {tele.map((t) => <HostCard key={t.hostId} t={t} />)}
          </div>
        )}
      </div>

      {/* Session metrics */}
      <div>
        <div className="kicker" style={{ marginBottom: 8 }}>Sessions</div>
        {sessions.length === 0 ? (
          <div className="soft" style={{ fontSize: 12.5 }}>No connected sessions.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {sessions.map((s) => <SessionCard key={s.id} s={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}
