import { todoProgress } from "./todoStats";

/**
 * A progress ring for a set of checklist items — a faint full-circle track with a
 * plain chalk arc for the completed fraction, and a `done/total` + `%` label in
 * the center. Reflects whatever list it's given (user todos, Claude's plan, or —
 * later — Jira sprint issues), so the caller decides what "done" means.
 */
export default function TodoProgress({
  items,
  label,
  size = 66,
}: {
  items: { done: boolean }[];
  /** Small caption under the count (e.g. "tasks", "plan"). */
  label?: string;
  size?: number;
}) {
  const { done, total, pct } = todoProgress(items);
  const stroke = 6;
  const r = (100 - stroke) / 2; // in a 0..100 viewBox
  const C = 2 * Math.PI * r;
  const dash = (pct / 100) * C;
  const complete = total > 0 && done === total;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", transform: "rotate(-90deg)" }}>
          {/* faint full-circle track */}
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(232,230,225,0.14)" strokeWidth={stroke} />
          {/* progress arc */}
          {pct > 0 && (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="var(--text)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C}`}
              style={{ transition: "stroke-dasharray .5s cubic-bezier(.4,0,.2,1)" }}
            />
          )}
        </svg>
        {/* center label (upright — the svg is rotated, not this) */}
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", lineHeight: 1 }}>
          <div style={{ textAlign: "center" }}>
            <div className="mono" style={{ fontSize: size * 0.2, fontWeight: 700, color: complete ? "var(--text-soft)" : "var(--text)" }}>
              {done}<span className="faint" style={{ fontWeight: 400 }}>/{total}</span>
            </div>
            <div className="mono faint" style={{ fontSize: size * 0.14, marginTop: 1 }}>{pct}%</div>
          </div>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-soft)" }}>
          {complete ? "all done" : "progress"}
        </div>
        {label && <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>{label}</div>}
      </div>
    </div>
  );
}
