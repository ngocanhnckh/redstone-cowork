import land from "../assets/geo/land.json";

// Shared equirectangular world map (dot-matrix "Signal Room" look) used by the Network
// Map widget and the full-screen IP Inspector. viewBox is 360×180: x = lon+180, y = 90−lat.
export const W = 360, H = 180;
export const projX = (lon: number) => lon + 180;
export const projY = (lat: number) => 90 - lat;

const FEATS: number[][][][] = (() => {
  const fc = land as unknown as { features: { geometry: { type: string; coordinates: unknown } }[] };
  const feats: number[][][][] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    const polys: number[][][][] = g.type === "Polygon" ? [g.coordinates as number[][][]] :
      g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : [];
    for (const poly of polys) feats.push(poly.map((r) => r.map(([lon, lat]) => [projX(lon), projY(lat)])));
  }
  return feats;
})();

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function isLand(x: number, y: number): boolean {
  return FEATS.some((rings) => rings.reduce((acc, r) => (inRing(x, y, r) ? !acc : acc), false));
}

/** One SVG path of tiny squares sampling the land on a grid. `step`/`dot` control density
 *  (smaller = finer). Computed lazily + cached per (step,dot) since it's point-in-polygon. */
const dotCache = new Map<string, string>();
export function dotPath(step = 3.2, dot = 1.1): string {
  const key = `${step},${dot}`;
  const hit = dotCache.get(key);
  if (hit) return hit;
  let d = "";
  for (let y = 2; y < H; y += step)
    for (let x = 2; x < W; x += step)
      if (isLand(x, y)) d += `M${(x - dot / 2).toFixed(1)} ${(y - dot / 2).toFixed(1)}h${dot}v${dot}h-${dot}Z`;
  dotCache.set(key, d);
  return d;
}
