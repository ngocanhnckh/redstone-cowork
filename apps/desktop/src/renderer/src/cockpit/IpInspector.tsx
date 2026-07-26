import { useEffect, useState } from "react";
import { useStore } from "../store";
import { W, H, projX, projY, dotPath } from "./worldmap";
import type { IpInfo } from "../../../shared/ip";

// Full-screen IP Inspector. Click any IP in the Network Map → this window opens, runs a
// "locating / scanning" sweep over a world map while it looks the IP up online (ASN, org,
// ISP, geo via the main process), then drops a target on the map and shows the details.

const DOTS = dotPath(2.6, 1.0); // a touch finer than the widget, since this map is large

const CSS = `
.ipi-scrim { position:fixed; inset:0; z-index:220; display:flex; align-items:center; justify-content:center; padding:3vh 3vw;
  background:rgb(4 6 10 / .72); backdrop-filter:blur(6px); animation:ipi-fade .18s ease both; }
@keyframes ipi-fade { from { opacity:0 } to { opacity:1 } }
.ipi { width:100%; max-width:1180px; height:100%; max-height:860px; display:flex; flex-direction:column;
  border:1px solid var(--border-strong, rgba(255,255,255,.18)); border-radius:16px; overflow:hidden;
  background: color-mix(in srgb, var(--app-panel) 97%, transparent); box-shadow:0 40px 120px rgb(0 0 0 / .7); }
.ipi-head { display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--border); flex-shrink:0; }
.ipi-head .t { font-family:var(--font-mono); font-size:11px; letter-spacing:.24em; color:var(--text-soft); }
.ipi-head .ip { font-family:var(--font-display,var(--font-mono)); font-size:20px; font-weight:700; color:var(--text); letter-spacing:.02em; }
.ipi-x { margin-left:auto; border:1px solid var(--border); background:transparent; color:var(--text-soft); border-radius:8px; padding:6px 12px; cursor:pointer; font-family:var(--font-mono); font-size:11px; }
.ipi-x:hover { color:var(--text); border-color:var(--border-strong); }
.ipi-body { flex:1; min-height:0; display:grid; grid-template-columns: 1.55fr 1fr; }
@media (max-width:820px){ .ipi-body { grid-template-columns:1fr; } }
.ipi-map { position:relative; min-width:0; min-height:0; background:radial-gradient(120% 100% at 50% 30%, rgb(255 255 255 / .04), rgb(4 6 10 / .5)); border-right:1px solid var(--border); }
.ipi-map svg { position:absolute; inset:0; width:100%; height:100%; }
.ipi-side { min-width:0; overflow-y:auto; padding:20px 22px; }
.ipi-status { position:absolute; left:0; right:0; bottom:16px; text-align:center; font-family:var(--font-mono); font-size:12px; letter-spacing:.14em; color:var(--text-soft); }
.ipi-status b { color:var(--text); }

/* scanning sweep bar while locating */
@keyframes ipi-sweep { 0% { transform:translateX(-120%) } 100% { transform:translateX(120%) } }
.ipi-sweepwrap { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
.ipi-sweep { position:absolute; top:0; bottom:0; width:36%; left:0;
  background:linear-gradient(90deg, transparent, rgb(255 255 255 / .10) 45%, rgb(255 255 255 / .22) 50%, rgb(255 255 255 / .10) 55%, transparent);
  animation: ipi-sweep 1.5s linear infinite; }
@keyframes ipi-ping { 0% { r:2; opacity:.9 } 100% { r:26; opacity:0 } }
@keyframes ipi-reticle { from { transform:rotate(0) } to { transform:rotate(360deg) } }

.ipi-row { display:flex; justify-content:space-between; gap:14px; padding:9px 0; border-bottom:1px solid var(--border); }
.ipi-row .k { font-family:var(--font-mono); font-size:9.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--text-faint); flex-shrink:0; padding-top:2px; }
.ipi-row .v { font-size:13px; color:var(--text); text-align:right; overflow-wrap:anywhere; }
.ipi-sec { font-family:var(--font-mono); font-size:9.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--text-soft); margin:18px 0 4px; }
.ipi-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
.ipi-chip { font-family:var(--font-mono); font-size:10px; letter-spacing:.08em; padding:4px 10px; border-radius:999px; border:1px solid var(--border); color:var(--text-soft); }
.ipi-chip.on { color:#111013; background:var(--text); border-color:transparent; font-weight:700; }
.ipi-err { color:#e63b2e; font-size:12px; padding:14px 0; }
`;

const flag = (cc?: string) => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === "") return null;
  return <div className="ipi-row"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

export default function IpInspector() {
  const ctx = useStore((s) => s.ipInspect);
  const close = useStore((s) => s.closeIpInspect);
  const [info, setInfo] = useState<IpInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ctx) { setInfo(null); return; }
    let alive = true; setLoading(true); setInfo(null);
    // Give the sweep a beat so it reads as "locating", even on a fast lookup.
    const started = Date.now();
    window.cowork.ipInfo(ctx.ip)
      .then(async (r) => {
        const wait = Math.max(0, 1100 - (Date.now() - started));
        if (wait) await new Promise((res) => setTimeout(res, wait));
        if (alive) { setInfo(r); setLoading(false); }
      })
      .catch(() => { if (alive) { setInfo({ ip: ctx.ip, ok: false, error: "lookup failed" }); setLoading(false); } });
    return () => { alive = false; };
  }, [ctx?.ip]); // eslint-disable-line

  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, close]);

  if (!ctx) return null;
  const located = !loading && info?.ok && info.lat != null && info.lon != null;
  const px = located ? projX(info!.lon!) : null;
  const py = located ? projY(info!.lat!) : null;

  return (
    <div className="ipi-scrim" onClick={close}>
      <style>{CSS}</style>
      <div className="ipi" onClick={(e) => e.stopPropagation()}>
        <div className="ipi-head">
          <span className="t">◈ IP INSPECTOR</span>
          <span className="ip">{ctx.ip}</span>
          {ctx.domain && <span className="t" style={{ letterSpacing: ".04em" }}>{ctx.domain}</span>}
          <button className="ipi-x" onClick={close}>ESC ✕</button>
        </div>
        <div className="ipi-body">
          <div className="ipi-map">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
              <g stroke="var(--text-faint)" strokeOpacity={0.12} strokeWidth={0.25}>
                {[30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={H} />)}
                {[30, 60, 90, 120, 150].map((y) => <line key={y} x1={0} y1={y} x2={W} y2={y} />)}
              </g>
              <path d={DOTS} fill="var(--text-soft)" fillOpacity={0.32} />
              {located && px != null && py != null && (
                <g>
                  <circle cx={px} cy={py} r={2.4} fill="none" stroke="var(--text)" strokeWidth={0.7}>
                    <animate attributeName="r" from="2" to="26" dur="2.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0.9" to="0" dur="2.2s" repeatCount="indefinite" />
                  </circle>
                  <g style={{ transformOrigin: `${px}px ${py}px`, animation: "ipi-reticle 6s linear infinite" }}>
                    <circle cx={px} cy={py} r={5} fill="none" stroke="var(--text)" strokeOpacity={0.5} strokeWidth={0.5} strokeDasharray="1.5 2" />
                  </g>
                  <circle cx={px} cy={py} r={2} fill="var(--text)" />
                  <circle cx={px} cy={py} r={2} fill="none" stroke="var(--text)" strokeOpacity={0.35} strokeWidth={2.5} />
                </g>
              )}
            </svg>
            {loading && (
              <>
                <div className="ipi-sweepwrap"><div className="ipi-sweep" /></div>
                <div className="ipi-status">LOCATING <b>{ctx.ip}</b> · SCANNING NETWORKS<span className="hud-blink">▮</span></div>
              </>
            )}
            {located && <div className="ipi-status"><b>{[info!.city, info!.country].filter(Boolean).join(", ")}</b> · {info!.lat!.toFixed(3)}, {info!.lon!.toFixed(3)}</div>}
            {!loading && info && !info.ok && <div className="ipi-status" style={{ color: "#e63b2e" }}>Couldn't locate this IP</div>}
            {!loading && info?.private && <div className="ipi-status">Private / local address — no public location</div>}
          </div>

          <div className="ipi-side">
            {loading ? (
              <div className="faint" style={{ fontSize: 12, padding: "20px 0", letterSpacing: ".1em" }}>Querying ASN registries + geo…</div>
            ) : info?.private ? (
              <>
                <div className="ipi-sec">This session</div>
                <Row k="Address" v={<span style={{ color: "var(--text-soft)" }}>{ctx.ip} · private/LAN</span>} />
                <Row k="Service" v={ctx.service ? `${ctx.service}${ctx.port ? ` · :${ctx.port}` : ""}` : (ctx.port ? `:${ctx.port}` : undefined)} />
                <Row k="Process" v={ctx.proc} />
              </>
            ) : info?.ok ? (
              <>
                <div className="ipi-sec">Network owner</div>
                <Row k="ASN" v={info.as} />
                <Row k="AS name" v={info.asname} />
                <Row k="Organization" v={info.org} />
                <Row k="ISP" v={info.isp} />
                <Row k="Reverse DNS" v={info.reverse} />

                <div className="ipi-sec">Location</div>
                <Row k="City" v={info.city} />
                <Row k="Region" v={info.region} />
                <Row k="Country" v={info.country ? `${flag(info.countryCode)} ${info.country}` : undefined} />
                <Row k="Coordinates" v={info.lat != null ? `${info.lat.toFixed(4)}, ${info.lon!.toFixed(4)}` : undefined} />
                <Row k="Timezone" v={info.timezone} />

                <div className="ipi-sec">This session</div>
                <Row k="Domain" v={ctx.domain} />
                <Row k="Service" v={ctx.service ? `${ctx.service}${ctx.port ? ` · :${ctx.port}` : ""}` : (ctx.port ? `:${ctx.port}` : undefined)} />
                <Row k="Process" v={ctx.proc} />

                <div className="ipi-chips">
                  {info.hosting && <span className="ipi-chip on">DATACENTER / HOSTING</span>}
                  {info.proxy && <span className="ipi-chip on">PROXY / VPN</span>}
                  {info.mobile && <span className="ipi-chip on">MOBILE</span>}
                  {!info.hosting && !info.proxy && !info.mobile && <span className="ipi-chip">RESIDENTIAL / DIRECT</span>}
                </div>
              </>
            ) : (
              <div className="ipi-err">⚠ {info?.error ?? "Lookup failed"}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
