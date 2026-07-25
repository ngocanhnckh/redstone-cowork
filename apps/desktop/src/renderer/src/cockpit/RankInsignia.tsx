import { RANKS, findRank } from "./ranks";

/**
 * Rank insignia as real drawn SVG (Lucide-style: currentColor strokes, square caps,
 * no emoji, no font glyphs) instead of the old "★★★" text strips.
 *
 * Shapes follow standard military convention so the ladder reads at a glance:
 *   enlisted → chevrons · officer → bars, then diamonds · general → stars
 * Count comes from the rank's position within its tier, so adding ranks to
 * ranks.ts needs no change here.
 */

type Props = { rank: string | null | undefined; size?: number; className?: string };

/** One filled chevron (enlisted). */
const Chevron = ({ x, s }: { x: number; s: number }) => (
  <path d={`M${x} ${s * 0.72} L${x + s * 0.5} ${s * 0.28} L${x + s} ${s * 0.72}`} fill="none" strokeWidth={s * 0.16} />
);
/** One vertical bar (company officer). */
const Bar = ({ x, s }: { x: number; s: number }) => (
  <rect x={x + s * 0.26} y={s * 0.2} width={s * 0.48} height={s * 0.6} fill="currentColor" stroke="none" />
);
/** One diamond (warrant / field officer). */
const Diamond = ({ x, s }: { x: number; s: number }) => (
  <path d={`M${x + s * 0.5} ${s * 0.16} L${x + s * 0.86} ${s * 0.5} L${x + s * 0.5} ${s * 0.84} L${x + s * 0.14} ${s * 0.5} Z`}
    fill="currentColor" stroke="none" />
);
/** One five-point star (general officer). */
const Star = ({ x, s }: { x: number; s: number }) => {
  const cx = x + s * 0.5, cy = s * 0.5, R = s * 0.42, r = R * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return <polygon points={pts.join(" ")} fill="currentColor" stroke="none" />;
};

/** How many pips this rank shows, and which shape, from its place in the ladder. */
function shapeFor(rankName: string): { kind: "chevron" | "bar" | "diamond" | "star"; count: number } | null {
  const r = findRank(rankName);
  if (!r) return null;
  const tierRanks = RANKS.filter((x) => x.tier === r.tier);
  const idx = tierRanks.findIndex((x) => x.name === r.name); // 0-based within tier
  if (r.tier === "enlisted") return idx === 0 ? null : { kind: "chevron", count: idx };
  if (r.tier === "general") return { kind: "star", count: idx + 1 };
  // officers: warrant = diamond, lieutenants/captain = bars, field grades = diamonds
  if (idx === 0) return { kind: "diamond", count: 1 };
  if (idx <= 3) return { kind: "bar", count: idx };
  return { kind: "diamond", count: idx - 3 };
}

export default function RankInsignia({ rank, size = 14, className }: Props) {
  const shape = shapeFor(rank ?? "");
  if (!shape) return null;
  const { kind, count } = shape;
  const gap = size * 0.18;
  const w = count * size + (count - 1) * gap;
  const Pip = kind === "chevron" ? Chevron : kind === "bar" ? Bar : kind === "diamond" ? Diamond : Star;
  return (
    <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} className={className}
      style={{ display: "block", overflow: "visible" }} aria-label={`${rank} insignia`}
      stroke="currentColor" strokeLinecap="square" strokeLinejoin="miter" fill="none">
      {Array.from({ length: count }, (_, i) => <Pip key={i} x={i * (size + gap)} s={size} />)}
    </svg>
  );
}
