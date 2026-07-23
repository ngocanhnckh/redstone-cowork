import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { NetPeer, NetworkMap } from "../types";
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

// Build one SVG path covering all land polygons (static — computed once).
const LAND_PATH = (() => {
  const fc = land as unknown as { features: { geometry: { type: string; coordinates: unknown } }[] };
  const parts: string[] = [];
  const ring = (r: number[][]) => {
    let d = "";
    r.forEach(([lon, lat], i) => { d += `${i ? "L" : "M"}${projX(lon).toFixed(1)},${projY(lat).toFixed(1)}`; });
    return d + "Z";
  };
  for (const f of fc.features) {
    const g = f.geometry;
    if (g.type === "Polygon") (g.coordinates as number[][][]).forEach((r) => (parts.push(ring(r))));
    else if (g.type === "MultiPolygon") (g.coordinates as number[][][][]).forEach((poly) => poly.forEach((r) => parts.push(ring(r))));
  }
  return parts.join("");
})();

function serviceColor(s: string | null): string {
  switch (s) {
    case "https": case "http": return "#54e6ff";
    case "ssh": return "#5ef2b0";
    case "dns": return "#ffd166";
    case "postgres": case "mysql": case "redis": case "mongo": case "mssql": case "oracle": return "#c792ff";
    case "smtp": case "smtps": case "imaps": case "imap": return "#ff8fa3";
    default: return "#8fb8ff";
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
  const [selIp, setSelIp] = useState<string | null>(null);

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
  const sel = peers.find((p) => p.ip === selIp) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, gap: 6 }}>
      <NetStyles />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 12 }}>🛰</span>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>Network</span>
        <span className="mono faint" style={{ fontSize: 9, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{machine ?? "no host"}</span>
        <span style={{ flex: 1 }} />
        <span className="mono faint" style={{ fontSize: 9 }}>{peers.length} link{peers.length === 1 ? "" : "s"}</span>
      </div>

      {/* World map */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "2 / 1", flexShrink: 0, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", background: "radial-gradient(120% 100% at 50% 30%, rgb(var(--primary) / 0.10), rgba(4,8,12,0.9))" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {/* graticule */}
          <g stroke="rgb(var(--primary-soft) / 0.10)" strokeWidth={0.3}>
            {[30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={H} />)}
            {[30, 60, 90, 120, 150].map((y) => <line key={y} x1={0} y1={y} x2={W} y2={y} />)}
          </g>
          <path d={LAND_PATH} fill="rgb(var(--primary-soft) / 0.12)" stroke="rgb(var(--primary-soft) / 0.35)" strokeWidth={0.25} />

          {/* arcs + travelling packets */}
          {hostPt && mapped.map(({ p, x, y }) => {
            const cx = (hostPt.x + x) / 2, cy = (hostPt.y + y) / 2 - Math.hypot(x - hostPt.x, y - hostPt.y) * 0.28;
            const d = `M${hostPt.x.toFixed(1)},${hostPt.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
            const on = p.ip === selIp;
            const col = serviceColor(p.service);
            const dur = 2 + (p.ip.charCodeAt(p.ip.length - 1) % 5) * 0.4;
            return (
              <g key={p.ip}>
                <path d={d} fill="none" stroke={col} strokeWidth={on ? 0.7 : 0.35} opacity={on ? 0.9 : 0.4} />
                <circle r={on ? 1.7 : 1.2} fill={col} style={{ filter: `drop-shadow(0 0 2px ${col})` }}>
                  <animateMotion path={d} dur={`${dur}s`} repeatCount="indefinite" calcMode="linear" />
                </circle>
              </g>
            );
          })}

          {/* peer nodes */}
          {mapped.map(({ p, x, y }) => {
            const on = p.ip === selIp; const col = serviceColor(p.service);
            return (
              <circle key={p.ip} cx={x} cy={y} r={on ? 2.6 : 1.7} fill={col} stroke="#04080c" strokeWidth={0.3}
                style={{ cursor: "pointer", filter: `drop-shadow(0 0 ${on ? 4 : 2}px ${col})` }}
                onClick={() => setSelIp((s) => (s === p.ip ? null : p.ip))}>
                <title>{peerLabel(p)} · {locLabel(p)}</title>
              </circle>
            );
          })}

          {/* host origin */}
          {hostPt && (
            <g>
              <circle cx={hostPt.x} cy={hostPt.y} r={2.4} fill="#fff" style={{ filter: "drop-shadow(0 0 4px rgb(var(--accent)))" }} />
              <circle cx={hostPt.x} cy={hostPt.y} r={2.4} fill="none" stroke="rgb(var(--accent))" strokeWidth={0.5} className="rcw-net-ping" />
            </g>
          )}
        </svg>
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
          const on = p.ip === selIp; const col = serviceColor(p.service);
          return (
            <div key={p.ip} onClick={() => setSelIp((s) => (s === p.ip ? null : p.ip))}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 5px", borderRadius: 5, cursor: "pointer", background: on ? "rgb(var(--primary) / 0.16)" : "transparent" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: col, boxShadow: `0 0 6px ${col}` }} />
              <span className="mono" style={{ fontSize: 10.5, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peerLabel(p)}</span>
              {p.proc && <span className="mono faint" style={{ fontSize: 8.5, flexShrink: 0 }}>{p.proc}</span>}
              <span className="mono" style={{ fontSize: 8.5, flexShrink: 0, color: col }}>{p.service || (p.port != null ? `:${p.port}` : "")}</span>
            </div>
          );
        })}
      </div>

      {/* Detail overlay */}
      {sel && (
        <div className="rcw-net-detail" onClick={() => setSelIp(null)}>
          <div className="rcw-net-detail-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: serviceColor(sel.service), boxShadow: `0 0 8px ${serviceColor(sel.service)}` }} />
              <span className="mono" style={{ fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peerLabel(sel)}</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setSelIp(null)} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "1px 7px", cursor: "pointer", fontSize: 11 }}>✕</button>
            </div>
            <DetailRow k="IP" v={sel.ip} />
            {sel.domain && <DetailRow k="Domain" v={sel.domain} />}
            <DetailRow k="Service" v={sel.service ? `${sel.service}${sel.port != null ? ` · :${sel.port}` : ""}` : (sel.port != null ? `:${sel.port}` : "—")} />
            <DetailRow k="Process" v={sel.proc ?? "— (needs ss -p perms)"} />
            <DetailRow k="Location" v={locLabel(sel)} />
            <DetailRow k="Connections" v={`×${sel.count}`} />
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "2px 0" }}>
      <span className="mono faint" style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>{k}</span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text)", minWidth: 0, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

function NetStyles() {
  return (
    <style>{`
      @keyframes rcw-net-ping { 0% { r:2.4; opacity:.9; } 100% { r:9; opacity:0; } }
      @keyframes rcw-net-fade { from { opacity:0; } to { opacity:1; } }
      .rcw-net-ping { animation: rcw-net-ping 2.2s ease-out infinite; transform-box: fill-box; }
      body.rcw-hidden .rcw-net-ping { animation-play-state: paused !important; }
      .rcw-net-detail { position:absolute; inset:0; z-index:8; display:flex; align-items:center; justify-content:center; padding:12px;
        background: rgba(4,8,12,0.55); backdrop-filter: blur(2px); border-radius:12px; animation: rcw-net-fade .18s ease both; }
      .rcw-net-detail-card { width:100%; max-width:240px; border:1px solid var(--border-strong); border-radius:11px; padding:11px 13px;
        background: color-mix(in srgb, var(--app-panel) 94%, transparent); box-shadow:0 16px 44px rgba(0,0,0,0.55); }
    `}</style>
  );
}
