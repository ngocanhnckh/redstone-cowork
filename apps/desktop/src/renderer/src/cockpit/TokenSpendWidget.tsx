import { useMemo } from "react";
import { useStore } from "../store";

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
};

/** Stacked bars (input + output) per recorded turn. */
function SpendChart({ series }: { series: { t: string; input: number; output: number }[] }) {
  const H = 68;
  // Per-turn deltas from the cumulative series (so bars = tokens spent that turn).
  const bars = useMemo(() => {
    const out: { input: number; output: number }[] = [];
    for (let i = 0; i < series.length; i++) {
      const prev = i > 0 ? series[i - 1] : { input: 0, output: 0 };
      out.push({ input: Math.max(0, series[i].input - prev.input), output: Math.max(0, series[i].output - prev.output) });
    }
    return out.slice(-40);
  }, [series]);
  const peak = Math.max(1, ...bars.map((b) => b.input + b.output));

  if (bars.length === 0) return <div className="mono faint" style={{ fontSize: 10.5, padding: "8px 2px" }}>no turns yet</div>;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: H }}>
      {bars.map((b, i) => {
        const total = b.input + b.output;
        const h = (total / peak) * H;
        const outH = total > 0 ? (b.output / total) * h : 0;
        return (
          <div key={i} title={`turn: ${total.toLocaleString()} tok (out ${b.output.toLocaleString()}, in ${b.input.toLocaleString()})`}
            style={{ flex: 1, minWidth: 2, height: Math.max(2, h), display: "flex", flexDirection: "column", justifyContent: "flex-end", borderRadius: 2, overflow: "hidden", background: "rgb(var(--primary-soft) / 0.35)" }}>
            <div style={{ height: outH, background: "rgb(var(--accent))" }} />
          </div>
        );
      })}
    </div>
  );
}

const metric = (label: string, value: string, color?: string) => (
  <div><div className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div><div style={{ fontSize: 15, fontFamily: "var(--font-mono)", color }}>{value}</div></div>
);

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", background: "rgb(var(--primary) / 0.03)", position: "relative", overflow: "hidden" };

/** Token spend for the focused session: totals + a per-turn chart over time. */
export default function TokenSpendWidget() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);

  const input = session?.tokensInput ?? 0;
  const output = session?.tokensOutput ?? 0;
  const total = input + output;

  return (
    <div style={card}>
      <span className="hud-corner" />
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)", marginBottom: 10 }}>Token Spend</div>
      {!session ? (
        <span className="mono faint" style={{ fontSize: 11 }}>no session selected</span>
      ) : total === 0 ? (
        <span className="mono faint" style={{ fontSize: 11 }}>no usage recorded yet</span>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))", gap: 12, marginBottom: 12 }}>
            {metric("Total", fmt(total))}
            {metric("Output", fmt(output), "rgb(var(--accent))")}
            {metric("Input", fmt(input), "rgb(var(--primary-soft))")}
          </div>
          <SpendChart series={session.tokenSeries ?? []} />
          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            <span className="mono faint" style={{ fontSize: 9 }}><span style={{ color: "rgb(var(--accent))" }}>▮</span> output</span>
            <span className="mono faint" style={{ fontSize: 9 }}><span style={{ color: "rgb(var(--primary-soft))" }}>▮</span> input</span>
            <span style={{ flex: 1 }} />
            <span className="mono faint" style={{ fontSize: 9 }}>per turn</span>
          </div>
        </>
      )}
    </div>
  );
}
