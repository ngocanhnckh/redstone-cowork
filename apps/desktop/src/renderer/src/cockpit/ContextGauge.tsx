// A compact context-window usage gauge (tokens used / model limit), like Claude
// Code's "% context used". Model id → context window size.
function contextLimit(model: string | null): number {
  const m = (model ?? "").toLowerCase();
  if (m.includes("[1m]") || m.includes("-1m")) return 1_000_000;
  // All current Claude 4.x models are 200k unless the 1M beta is on.
  return 200_000;
}

const fmtK = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

export default function ContextGauge({ contextTokens, model }: { contextTokens: number | null; model: string | null }) {
  if (contextTokens == null) return null;
  const limit = contextLimit(model);
  const pct = Math.max(0, Math.min(100, (contextTokens / limit) * 100));
  // Warm→amber→red as it fills; auto-compact tends to kick in ~75-80%.
  const color = pct >= 85 ? "#e0736a" : pct >= 70 ? "#D8A76A" : "rgb(var(--primary-soft))";

  return (
    <span title={`Context: ${contextTokens.toLocaleString()} / ${limit.toLocaleString()} tokens${model ? ` · ${model}` : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
      <span className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>ctx</span>
      <span style={{ position: "relative", width: 62, height: 5, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <span style={{ position: "absolute", inset: 0, width: `${pct}%`, background: color, borderRadius: 999, transition: "width .5s ease" }} />
      </span>
      <span className="mono" style={{ fontSize: 10, color, minWidth: 30 }}>{Math.round(pct)}%</span>
      <span className="mono faint" style={{ fontSize: 9.5 }}>{fmtK(contextTokens)}</span>
    </span>
  );
}
