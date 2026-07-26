import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { NetPeer, NetworkMap } from "../types";
import { IconSatellite } from "./Icons";
import land from "../assets/geo/land.json";

// Network Map widget: a futuristic equirectangular world map of the focused host's
// live TCP connections. Packets animate from the host to each peer; a log below lists
// every connection, and clicking one reveals its detail (IP / domain / service /
// process / location). All data comes from an SSH `ss -tnp` read enriched offline
// (bundled GeoIP + reverse DNS) in the main process — see main/network.ts.

// Equirectangular projection into a 360×180 viewBox: x = lon+180, y = 90-lat.
const W = 360, H = 180;
const projX = (lon: number) => lon + 180;
const projY = (lat: number) => 90 - lat;

// Dot-matrix land (the Signal Room look): sample the land polygons on a grid and
// emit ONE path of tiny squares — computed once at module load from real geography.
const DOT_PATH = (() => {
  const fc = land as unknown as { features: { geometry: { type: string; coordinates: unknown } }[] };
  // collect each feature's rings (outer + holes), projected
  const feats: number[][][][] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    const polys: number[][][][] = g.type === "Polygon" ? [g.coordinates as number[][][]] :
      g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : [];
    for (const poly of polys) feats.push(poly.map((r) => r.map(([lon, lat]) => [projX(lon), projY(lat)])));
  }
  const inRing = (x: number, y: number, ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const isLand = (x: number, y: number) =>
    feats.some((rings) => rings.reduce((acc, r) => (inRing(x, y, r) ? !acc : acc), false));
  const STEP = 3.2, DOT = 1.1;
  let d = "";
  for (let y = 2; y < H; y += STEP)
    for (let x = 2; x < W; x += STEP)
      if (isLand(x, y)) d += `M${(x - DOT / 2).toFixed(1)} ${(y - DOT / 2).toFixed(1)}h${DOT}v${DOT}h-${DOT}Z`;
  return d;
})();

// One muted, warm-leaning "instrument" family so the map sits inside the clay/amber HUD
// instead of the old neon rainbow. Hues stay distinct enough to tell services apart, but
// share a dusty, low-saturation quality so nothing screams. Web traffic (the bulk) is
// amber — the theme's home key — so the map reads as part of the palette.
function serviceColor(s: string | null): string {
  switch (s) {
    case "https": case "http": return "#e8e6e1"; // brightest — everyday web (the bulk)
    case "ssh": return "#b5b2ab";                 // secure shell
    case "dns": return "#cfcdc7";                 // dns
    case "postgres": case "mysql": case "redis": case "mongo": case "mssql": case "oracle": return "#96938c"; // data stores
    case "smtp": case "smtps": case "imaps": case "imap": return "#7a776f"; // mail
    default: return "#5f5c55";                     // other
  }
}

const peerLabel = (p: NetPeer) => p.domain || p.ip;
const locLabel = (p: { city: string | null; country: string | null }) => [p.city, p.country].filter(Boolean).join(", ") || "unknown";

export default function NetMap() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const machine = useMemo(() => [...sessions, ...queue].find((x) => x.id === focusId)?.machine ?? null, [focusId, sessions, queue]);
  const [map, setMap] = useState<NetworkMap | null>(null);
  const openIp = useStore((s) => s.openIpInspect);

  useEffect(() => {
    if (!machine) { setMap(null); return; }
    let alive = true;
    const load = () => { window.cowork.networkMap(machine).then((m) => { if (alive) setMap(m); }).catch(() => { if (alive) setMap(null); }); };
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [machine]);

  const host = map?.host ?? null;
  const hostPt = host && host.lat != null && host.lon != null ? { x: projX(host.lon), y: projY(host.lat) } : null;
  const peers = map?.peers ?? [];
  const mapped = useMemo(() => peers.filter((p) => p.lat != null && p.lon != null).map((p) => ({ p, x: projX(p.lon!), y: projY(p.lat!) })), [peers]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, gap: 6 }}>
      <NetStyles />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <IconSatellite size={13} style={{ color: "var(--text-soft)" }} />
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>Network</span>
        <span className="mono faint" style={{ fontSize: 9, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{machine ?? "no host"}</span>
        <span style={{ flex: 1 }} />
        <span className="mono faint" style={{ fontSize: 9 }}>{peers.length} link{peers.length === 1 ? "" : "s"}</span>
      </div>

      {/* World map */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "2 / 1", flexShrink: 0, overflow: "hidden", border: "1px solid var(--border)", background: "rgba(6,6,6,0.55)" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {/* graticule */}
          <g stroke="rgb(var(--primary-soft) / 0.10)" strokeWidth={0.3}>
            {[30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={H} />)}
            {[30, 60, 90, 120, 150].map((y) => <line key={y} x1={0} y1={y} x2={W} y2={y} />)}
          </g>
          <path d={DOT_PATH} fill="rgba(232,230,225,0.26)" />

          {/* arcs + travelling packets */}
          {hostPt && mapped.map(({ p, x, y }) => {
            const cx = (hostPt.x + x) / 2, cy = (hostPt.y + y) / 2 - Math.hypot(x - hostPt.x, y - hostPt.y) * 0.28;
            const d = `M${hostPt.x.toFixed(1)},${hostPt.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
            const on = false;
            return (
              <path key={p.ip} d={d} fill="none" className="rcw-net-arc"
                stroke="#e63b2e" strokeWidth={on ? 0.8 : 0.45} opacity={on ? 0.95 : 0.55}
                strokeDasharray="1.6 2.6" />
            );
          })}

          {/* peer nodes */}
          {mapped.map(({ p, x, y }) => {
            const col = serviceColor(p.service);
            return (
              <g key={p.ip} style={{ cursor: "pointer" }}
                onClick={() => openIp({ ip: p.ip, domain: p.domain, service: p.service, port: p.port, proc: p.proc })}>
                {/* glow lights up as the radar sweep passes this longitude */}
                <circle cx={x} cy={y} r={3.6} fill="#e8e6e1" className="rcw-net-glow" style={{ animationDelay: `${(-(x / W) * 5).toFixed(2)}s` }} />
                <rect x={x - 1.5} y={y - 1.5} width={3} height={3} fill={col} />
                <title>{peerLabel(p)} · {locLabel(p)} — click to inspect</title>
              </g>
            );
          })}

          {/* host origin */}
          {hostPt && (
            <g>
              <rect x={hostPt.x - 2} y={hostPt.y - 2} width={4} height={4} fill="#e63b2e" />
              <circle cx={hostPt.x} cy={hostPt.y} r={2.4} fill="none" stroke="#e63b2e" strokeWidth={0.5} className="rcw-net-ping" />
            </g>
          )}
        </svg>
        {mapped.length > 0 && <div className="rcw-net-sweepline" />}
        {map && !map.geo && (
          <div className="mono faint" style={{ position: "absolute", bottom: 4, left: 6, right: 6, fontSize: 8.5, textAlign: "center" }}>geo DB missing — run “pnpm --filter @rcw/desktop geoip”</div>
        )}
      </div>

      {/* Connection log */}
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {!machine ? (
          <span className="mono faint" style={{ fontSize: 10.5 }}>focus a session</span>
        ) : peers.length === 0 ? (
          <span className="mono faint" style={{ fontSize: 10.5 }}>{map ? "no external connections" : "scanning…"}</span>
        ) : peers.map((p) => {
          const on = false; const col = serviceColor(p.service);
          return (
            <div key={p.ip} onClick={() => openIp({ ip: p.ip, domain: p.domain, service: p.service, port: p.port, proc: p.proc })}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 5px", borderRadius: 5, cursor: "pointer", background: on ? "rgba(232,230,225,0.16)" : "transparent" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: col }} />
              <span className="mono" style={{ fontSize: 10.5, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peerLabel(p)}</span>
              {p.proc && <span className="mono faint" style={{ fontSize: 8.5, flexShrink: 0 }}>{p.proc}</span>}
              <span className="mono" style={{ fontSize: 8.5, flexShrink: 0, color: col }}>{p.service || (p.port != null ? `:${p.port}` : "")}</span>
            </div>
          );
        })}
      </div>

    </div>
  );
}


function NetStyles() {
  return (
    <style>{`
      @keyframes rcw-net-ping { 0% { r:2.4; opacity:.9; } 100% { r:9; opacity:0; } }
      @keyframes rcw-net-dash { to { stroke-dashoffset: -42; } }
      .rcw-net-arc { animation: rcw-net-dash 2.6s linear infinite; }
      body.rcw-hidden .rcw-net-arc { animation-play-state: paused !important; }
      @keyframes rcw-net-fade { from { opacity:0; } to { opacity:1; } }
      .rcw-net-ping { animation: rcw-net-ping 2.2s ease-out infinite; transform-box: fill-box; }
      body.rcw-hidden .rcw-net-ping { animation-play-state: paused !important; }
      /* radar sweep line + per-blip flash (delay is set inline so each lights as the line passes) */
      @keyframes rcw-net-sweepx { from { left:0%; } to { left:100%; } }
      .rcw-net-sweepline { position:absolute; top:0; bottom:0; width:2px; z-index:3; pointer-events:none;
        background: linear-gradient(180deg, transparent, rgba(232,230,225,.85), transparent); opacity:.5;
        box-shadow: 0 0 16px 3px rgba(232,230,225,.18); animation: rcw-net-sweepx 5s linear infinite; }
      @keyframes rcw-net-flash { 0% { opacity:.95; } 12% { opacity:0; } 100% { opacity:0; } }
      .rcw-net-glow { animation: rcw-net-flash 5s linear infinite; transform-box: fill-box; }
      body.rcw-hidden .rcw-net-sweepline, body.rcw-hidden .rcw-net-glow { animation-play-state: paused !important; }
      .rcw-net-detail { position:absolute; inset:0; z-index:8; display:flex; align-items:center; justify-content:center; padding:12px;
        background: rgba(4,8,12,0.55); backdrop-filter: blur(2px); border-radius:12px; animation: rcw-net-fade .18s ease both; }
      .rcw-net-detail-card { width:100%; max-width:240px; border:1px solid var(--border-strong); border-radius:11px; padding:11px 13px;
        background: color-mix(in srgb, var(--app-panel) 94%, transparent); box-shadow:0 16px 44px rgba(0,0,0,0.55); }
    `}</style>
  );
}
