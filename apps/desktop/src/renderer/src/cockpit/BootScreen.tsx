import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { playSfx } from "../sfx";

// Play the boot chime once per app launch (BootScreen can remount on reconnects).
let bootChimePlayed = false;

// The boot sequence shown until the FIRST session fetch succeeds. It doubles as an
// honest connection monitor: it streams a fast boot log while connecting; if the
// fetch fails it freezes and shows the REAL reason + a retry — so a connection error
// is never masked by a misleading "All clear" empty state.

// req() throws bare HTTP statuses ("401") / fetch failures ("Failed to fetch"), but
// the renderer sees them WRAPPED by Electron IPC as
//   "Error invoking remote method 'api:queue': Error: 401"
// so we scan for the status code ANYWHERE in the string, not an exact match.
function statusOf(e: string): number | null {
  const m = (e || "").match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : null;
}
function humanizeError(e: string): string {
  const code = statusOf(e);
  if (code === 401 || code === 403) return `The cowork server rejected your token (HTTP ${code}) — it's expired or no longer valid. Sign in again to reconnect.`;
  if (code === 502 || code === 503 || code === 504) return `Cowork server is unreachable or restarting (HTTP ${code}).`;
  if (code) return `Cowork server responded HTTP ${code}.`;
  if (/failed to fetch|networkerror|econnrefused|fetch failed/i.test(e || "")) return "Can't reach the cowork server — network down, server offline, or the web proxy hasn't reconnected.";
  return (e || "").trim() || "Unknown connection error.";
}

type Kind = "" | "ok" | "hl" | "warn";
type Line = { t: string; k: Kind };

// A short pseudo-hex token for the fast "data" lines between milestones.
function hex(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += "0123456789ABCDEF"[Math.floor(Math.random() * 16)];
  return s;
}

// Our OWN boot log — a plausible cold-boot sequence, branded for Redstone. Interleaves
// milestone lines (ok/hl) with fast "probe" lines so it scrolls like a system booting.
function buildBootLog(): Line[] {
  const out: Line[] = [];
  const push = (t: string, k: Kind = "") => out.push({ t, k });
  const fill = (n: number) => { for (let i = 0; i < n; i++) push(`  · 0x${hex(4)}  ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)}  ok`); };

  push("REDSTONE bootrom v4.8 — power-on self test", "hl");
  push("  cpu: 8 logical cores online @ 3.2GHz", "ok");
  push("  mem: mapping 32768M ................ ok", "ok");
  push("  dma: 64 channels armed", "ok");
  push("  crypto: aes-ni · curve25519 · sha3 ready", "ok");
  fill(3);
  push("[core] loading cockpit.core", "hl");
  push("[core] loading render.pipeline");
  push("[core] loading focus.theater");
  push("[core] loading session.grid");
  push("[core] loading hud.compositor");
  push("[core] loading telemetry.probe");
  fill(4);
  push("[ fs ] mounting workspace overlay ....... ok", "ok");
  push("[ fs ] scanning virtual apps");
  fill(2);
  push("[ net] bringing up uplink0", "hl");
  push("[ net] resolving cowork gateway");
  fill(3);
  push("[ tls] negotiating secure channel");
  push("[ tls] handshake ............ established", "ok");
  push("[auth] presenting instance token", "hl");
  fill(2);
  push("[sync] subscribing to session stream");
  push("[scan] enumerating active sessions");
  fill(3);
  return out;
}
const BOOT_LOG = buildBootLog();

const CSS = `
@keyframes rcw-boot-line { from { opacity: 0; transform: translateX(-7px); } to { opacity: 1; transform: none; } }
@keyframes rcw-boot-caret { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes rcw-boot-scan { 0% { top: -6%; } 100% { top: 106%; } }
@keyframes rcw-boot-title { 0% { opacity: 0; transform: translateY(8px); letter-spacing: 0.5em; filter: blur(5px); } 100% { opacity: 1; transform: none; filter: none; } }
@keyframes rcw-boot-grid { to { background-position: 0 -34px, -34px 0; } }
.rcw-boot { position:absolute; inset:0; overflow:hidden; display:flex; flex-direction:column;
  background: radial-gradient(120% 90% at 50% 30%, rgb(var(--primary) / 0.08), transparent 70%); }
.rcw-boot-grid { position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image: linear-gradient(rgb(var(--primary-soft) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--primary-soft) / 0.06) 1px, transparent 1px);
  background-size: 34px 34px, 34px 34px; animation: rcw-boot-grid 3.4s linear infinite;
  -webkit-mask-image: radial-gradient(80% 70% at 50% 40%, #000 40%, transparent 85%); mask-image: radial-gradient(80% 70% at 50% 40%, #000 40%, transparent 85%); }
.rcw-boot-scan { position:absolute; left:0; right:0; height:2px; z-index:3; pointer-events:none; opacity:.55;
  background: linear-gradient(90deg, transparent, rgb(var(--primary-soft) / 0.6), transparent); box-shadow: 0 0 16px 2px rgb(var(--primary-soft) / 0.35); animation: rcw-boot-scan 2.6s linear infinite; }
.rcw-boot-title { text-align:center; padding: 26px 20px 10px; position:relative; z-index:2; animation: rcw-boot-title 0.9s ease both; }
.rcw-boot-log { flex:1; min-height:0; overflow:hidden; position:relative; z-index:2;
  font-family: var(--font-mono); font-size: 12px; line-height: 1.62; padding: 4px 26px 18px; color: var(--text-faint);
  -webkit-mask-image: linear-gradient(transparent, #000 12%); mask-image: linear-gradient(transparent, #000 12%); }
.rcw-boot-log .l { white-space:pre; animation: rcw-boot-line .1s ease both; }
.rcw-boot-log .ok { color: rgb(var(--accent)); }
.rcw-boot-log .hl { color: rgb(var(--primary-soft)); text-shadow: 0 0 10px rgb(var(--primary-soft) / 0.4); }
.rcw-boot-log .warn { color: #e0a24a; }
.rcw-boot-foot { position:relative; z-index:2; padding: 12px 26px 22px; }
`;

export default function BootScreen() {
  const error = useStore((s) => s.error);
  const refresh = useStore((s) => s.refresh);
  const authRejected = /\b(401|403)\b/.test(error ?? "") || /unauthor/i.test(error ?? "");
  const signInAgain = () => { window.cowork.clearConfig().then(() => window.location.reload()).catch(() => window.location.reload()); };
  const failed = !!error;

  const [log, setLog] = useState<Line[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const accent = failed ? "#e0736a" : "rgb(var(--accent))";

  // Boot chime — once per launch.
  useEffect(() => {
    if (!bootChimePlayed) { bootChimePlayed = true; playSfx("boot"); }
  }, []);

  // Stream the boot log fast while connecting; hold at the end (still "establishing
  // uplink"); freeze immediately on error so the failure reads clearly.
  useEffect(() => {
    if (failed) return;
    let i = 0;
    const id = setInterval(() => {
      setLog((cur) => (i >= BOOT_LOG.length ? cur : [...cur, BOOT_LOG[i++]].slice(-140)));
    }, 55);
    return () => clearInterval(id);
  }, [failed]);

  // Auto-scroll to the newest line.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Keep retrying on a NETWORK/server error so the app recovers when the server/proxy
  // comes back. Don't auto-retry an auth rejection — the token won't fix itself.
  useEffect(() => {
    if (!failed || authRejected) return;
    const t = setInterval(() => refresh(), 5000);
    return () => clearInterval(t);
  }, [failed, authRejected, refresh]);

  return (
    <div className="rcw-boot">
      <style>{CSS}</style>
      <span className="rcw-boot-grid" />
      <span className="rcw-boot-scan" />

      <div className="rcw-boot-title">
        <div className="display" style={{ fontSize: 34, letterSpacing: "0.14em", lineHeight: 1, textShadow: `0 0 26px ${accent}` }}>
          REDSTONE<span style={{ color: accent }}> COWORK</span>
        </div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: "0.4em", textTransform: "uppercase", color: "var(--text-faint)", marginTop: 8 }}>
          Session Control Plane
        </div>
      </div>

      <div className="rcw-boot-log no-scrollbar" ref={logRef}>
        {log.map((l, i) => (
          <div key={i} className={`l ${l.k}`}>{l.t}</div>
        ))}
        {!failed && (
          <div className="l hl">
            {"[sync] establishing uplink"}<span style={{ animation: "rcw-boot-caret 1s step-end infinite" }}> █</span>
          </div>
        )}
      </div>

      <div className="rcw-boot-foot">
        {failed ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <div className="mono" style={{ fontSize: 12.5, color: "#e0736a", fontWeight: 600, letterSpacing: "0.06em" }}>◈ UPLINK FAILED</div>
            <p style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6, margin: 0, maxWidth: 520 }}>{humanizeError(error)}</p>
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              {authRejected && (
                <button onClick={signInAgain} className="glass-btn--clay" style={{ padding: "9px 20px", fontSize: 13, fontWeight: 600 }}>
                  ⤿ Sign in again
                </button>
              )}
              <button
                onClick={() => { setLog([]); refresh(); }}
                className={authRejected ? "" : "glass-btn--clay"}
                style={{ padding: "9px 20px", fontSize: 13, fontWeight: 600, ...(authRejected ? { background: "transparent", border: "1px solid var(--border)", color: "var(--text-soft)", borderRadius: 10, cursor: "pointer" } : {}) }}
              >
                ↻ Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Connecting to cowork…
          </div>
        )}
      </div>
    </div>
  );
}
