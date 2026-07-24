import type { AgencyGithubDay } from "../../../shared/agency";

// Shared Agency chart primitives (self-contained SVG — no external libs, CSP-safe).

export function fmtK(n: number): string {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
}

/** A grid of labelled stat tiles (real numbers). */
export function Tiles({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="agp-tiles">
      {items.map((t) => (
        <div key={t.label} className="agp-tile">
          <div className="agp-tile-v">{t.value}</div>
          <div className="agp-tile-l">{t.label}</div>
          {t.hint && <div className="agp-tile-h">{t.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Horizontal labelled bar chart (each row scaled to the max). */
export function Bars({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 78, fontSize: 10, letterSpacing: "0.08em", color: "var(--text-soft)", textAlign: "right", flexShrink: 0 }}>{r.label}</span>
          <div style={{ flex: 1, height: 12, borderRadius: 6, background: "rgb(var(--primary) / 0.08)", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: 6, background: r.color, minWidth: r.value > 0 ? 4 : 0, transition: "width .5s ease" }} />
          </div>
          <b style={{ width: 32, fontSize: 12, color: "#e6f2f4", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

const fmtDate = (t: number) => {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Cumulative area chart with a real DATE x-axis + a y-axis max label. */
export function ActivityChart({ points, label, unit }: { points: Array<{ t: number; v: number }>; label: string; unit?: string }) {
  const W = 520, H = 150, padL = 44, padR = 8, padT = 8, padB = 22;
  if (points.length < 2) return (
    <div>
      <div className="mono" style={{ fontSize: 9, letterSpacing: "0.22em", color: "rgb(var(--primary-soft))", marginBottom: 6 }}>{label}</div>
      <div className="soft" style={{ fontSize: 11.5, padding: "18px 4px" }}>Not enough activity history yet for a trend.</div>
    </div>
  );
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const vMax = points[points.length - 1].v || 1;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / vMax) * (H - padT - padB);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - padB} L${x(t0).toFixed(1)},${H - padB} Z`;
  const midT = (t0 + t1) / 2;
  return (
    <div>
      <div className="mono" style={{ fontSize: 9, letterSpacing: "0.22em", color: "rgb(var(--primary-soft))", marginBottom: 6 }}>{label}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id="agp-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--primary) / 0.45)" />
            <stop offset="100%" stopColor="rgb(var(--primary) / 0.02)" />
          </linearGradient>
        </defs>
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgb(255 255 255 / 0.14)" strokeWidth={1} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgb(255 255 255 / 0.14)" strokeWidth={1} />
        {/* y ticks */}
        <text x={padL - 6} y={y(vMax)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="var(--text-faint)">{fmtK(vMax)}{unit ? ` ${unit}` : ""}</text>
        <text x={padL - 6} y={y(vMax / 2)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="var(--text-faint)">{fmtK(vMax / 2)}</text>
        {/* series */}
        <path d={area} fill="url(#agp-fill)" />
        <path d={line} fill="none" stroke="rgb(var(--primary))" strokeWidth={2} />
        {/* x ticks — start / mid / end dates */}
        <text x={padL} y={H - 6} textAnchor="start" fontSize={9} fill="var(--text-faint)">{fmtDate(t0)}</text>
        <text x={(padL + W - padR) / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-faint)">{fmtDate(midT)}</text>
        <text x={W - padR} y={H - 6} textAnchor="end" fontSize={9} fill="var(--text-faint)">{fmtDate(t1)}</text>
      </svg>
    </div>
  );
}

const GH_LEVELS = ["rgb(var(--primary) / 0.08)", "rgb(var(--primary) / 0.3)", "rgb(var(--primary) / 0.5)", "rgb(var(--primary) / 0.72)", "rgb(var(--primary) / 0.95)"];
function ghLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  const q = count / Math.max(1, max);
  return q > 0.66 ? 4 : q > 0.4 ? 3 : q > 0.15 ? 2 : 1;
}

/** GitHub-style contribution heatmap: weeks × 7 days, coloured by daily count. */
export function GithubHeatmap({ days, total }: { days: AgencyGithubDay[]; total: number }) {
  if (!days.length) return <div className="soft" style={{ fontSize: 11.5 }}>No contribution data.</div>;
  // Group into week columns starting on the first day's weekday.
  const max = days.reduce((m, d) => Math.max(m, d.count), 0);
  const first = new Date(days[0].date + "T00:00:00");
  const startPad = first.getDay(); // 0=Sun
  const cells: Array<AgencyGithubDay | null> = [...Array(startPad).fill(null), ...days];
  const weeks: Array<Array<AgencyGithubDay | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const cell = 11, gap = 3;
  const W = weeks.length * (cell + gap), H = 7 * (cell + gap);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: "0.22em", color: "rgb(var(--primary-soft))" }}>CONTRIBUTIONS · LAST YEAR</span>
        <b style={{ fontSize: 13, color: "#e6f2f4" }}>{total.toLocaleString()}</b>
      </div>
      <div style={{ overflowX: "auto" }} className="no-scrollbar">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", minWidth: W }}>
          {weeks.map((wk, wi) => wk.map((d, di) => (
            <rect key={`${wi}-${di}`} x={wi * (cell + gap)} y={di * (cell + gap)} width={cell} height={cell} rx={2}
              fill={d ? GH_LEVELS[ghLevel(d.count, max)] : "transparent"}>
              {d && <title>{`${d.count} on ${d.date}`}</title>}
            </rect>
          )))}
        </svg>
      </div>
    </div>
  );
}
