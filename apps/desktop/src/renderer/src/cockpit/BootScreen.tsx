import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { playSfx } from "../sfx";
import yiaSealUrl from "../assets/yia-seal.png?url";
import { findRank } from "./ranks";

// Play the boot chime once per app launch (BootScreen can remount on reconnects).
let bootChimePlayed = false;

// A two-phase boot sequence (log → glitch title), paced to run for several seconds of
// CONTINUOUS motion so it matches the boot chime instead of flashing by. It also
// doubles as an honest connection monitor: on a fetch failure it freezes and shows the
// REAL reason + a retry, so an error is never masked by a misleading "All clear".

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
type Line = { t: string; k: Kind; d: number }; // d = delay (ms) after this line

function hex(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += "0123456789ABCDEF"[Math.floor(Math.random() * 16)];
  return s;
}

// Our OWN boot log — a cold-boot sequence branded for Redstone. Per-line delays are
// mostly fast with deliberate pauses at section boundaries, so it scrolls with rhythm.
function buildBootLog(): Line[] {
  const out: Line[] = [];
  const push = (t: string, k: Kind = "", d = 18) => out.push({ t, k, d });
  const probe = (n: number) => { for (let i = 0; i < n; i++) push(`  · 0x${hex(4)}  ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)}  ok`, "", 13); };

  push("YITEC secure bootrom v4.8 — power-on self test", "hl", 110);
  push("  cpu: 8 logical cores online @ 3.2GHz", "ok");
  push("  mem: mapping 32768M ................ ok", "ok");
  push("  dma: 64 channels armed", "ok");
  push("  crypto: aes-ni · curve25519 · sha3 ready", "ok", 95);
  probe(4);
  push("[core] loading cockpit.core", "hl", 90);
  push("[core] loading render.pipeline");
  push("[core] loading focus.theater");
  push("[core] loading session.grid");
  push("[core] loading hud.compositor");
  push("[core] loading telemetry.probe", "", 90);
  probe(5);
  push("[ fs ] mounting workspace overlay ....... ok", "ok", 90);
  push("[ fs ] scanning virtual apps");
  probe(3);
  push("[ net] bringing up uplink0", "hl", 90);
  push("[ net] resolving cowork gateway", "", 95);
  probe(4);
  push("[ tls] negotiating secure channel", "", 90);
  push("[ tls] handshake ............ established", "ok", 90);
  push("[auth] presenting instance token", "hl", 95);
  probe(3);
  push("[sync] subscribing to session stream", "", 90);
  push("[scan] enumerating active sessions", "", 140);
  return out;
}
const BOOT_LOG = buildBootLog();

const CSS = `
@keyframes rcw-boot-line { from { opacity: 0; transform: translateX(-7px); } to { opacity: 1; transform: none; } }
@keyframes rcw-boot-caret { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes rcw-boot-scan { 0% { top: -6%; } 100% { top: 106%; } }
@keyframes rcw-boot-grid { to { background-position: 0 -34px, -34px 0; } }
@keyframes rcw-boot-fadein { from { opacity: 0; } to { opacity: 1; } }
@keyframes rcw-boot-titlein { 0% { opacity: 0; transform: scale(1.06); filter: blur(6px); letter-spacing: .5em; } 100% { opacity: 1; transform: none; filter: none; } }
/* derez glitch — the title splits into top/bottom halves that jitter with a colour offset */
@keyframes rcw-derez-top { from { transform: translateX(-1.5%); } to { transform: translateX(-5%); } }
@keyframes rcw-derez-bot { from { transform: translateX(1.5%); } to { transform: translateX(4%); } }

.rcw-boot { position:absolute; inset:0; overflow:hidden; display:flex; flex-direction:column;
  background: radial-gradient(120% 90% at 50% 32%, rgb(var(--primary) / 0.08), transparent 70%); }
.rcw-boot-grid { position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image: linear-gradient(rgb(var(--primary-soft) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--primary-soft) / 0.06) 1px, transparent 1px);
  background-size: 34px 34px, 34px 34px; animation: rcw-boot-grid 3.4s linear infinite;
  -webkit-mask-image: radial-gradient(80% 70% at 50% 45%, #000 40%, transparent 85%); mask-image: radial-gradient(80% 70% at 50% 45%, #000 40%, transparent 85%); }
.rcw-boot-scan { position:absolute; left:0; right:0; height:2px; z-index:3; pointer-events:none; opacity:.55;
  background: linear-gradient(90deg, transparent, rgb(var(--primary-soft) / 0.6), transparent); box-shadow: 0 0 16px 2px rgb(var(--primary-soft) / 0.35); animation: rcw-boot-scan 2.6s linear infinite; }

/* Phase 1: boot log, anchored to the BOTTOM like a terminal boot (top clips off). */
.rcw-boot-log { flex:1; min-height:0; overflow:hidden; position:relative; z-index:2; display:flex; flex-direction:column; justify-content:flex-end;
  font-family: var(--font-mono); font-size: 12px; line-height: 1.62; padding: 4px 28px 20px; color: var(--text-faint);
  -webkit-mask-image: linear-gradient(transparent, #000 14%); mask-image: linear-gradient(transparent, #000 14%); }
.rcw-boot-log .l { white-space:pre; animation: rcw-boot-line .1s ease both; }
.rcw-boot-log .ok { color: rgb(var(--accent)); }
.rcw-boot-log .hl { color: rgb(var(--primary-soft)); text-shadow: 0 0 10px rgb(var(--primary-soft) / 0.4); }
.rcw-boot-log .warn { color: #e0a24a; }

/* Phase 2: centered glitch title. */
.rcw-boot-titlewrap { flex:1; min-height:0; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; animation: rcw-boot-fadein .25s ease both; }
.rcw-boot-h1 { position:relative; font-family: var(--font-display); font-weight:600; font-size: clamp(26px, 5.2vw, 58px); line-height:1.04; letter-spacing:.08em; text-align:center;
  padding-bottom: 14px; border-bottom: 2px solid rgb(var(--primary) / 0.7); text-shadow: 0 0 34px rgb(var(--primary-soft) / 0.6);
  animation: rcw-boot-titlein .32s linear both; }
.rcw-boot-seal { width: 176px; height: 176px; object-fit: contain; filter: drop-shadow(0 0 34px rgb(var(--primary-soft) / 0.6));
  animation: rcw-boot-titlein .5s ease both; }
.rcw-boot-access { font-family: var(--font-mono); font-size: 14px; letter-spacing: .55em; font-weight:700; color: rgb(var(--accent));
  text-shadow: 0 0 16px rgb(var(--accent) / 0.6); animation: rcw-boot-fadein .4s ease both; }
.rcw-boot-welcome { display:flex; align-items:center; gap:20px; margin-top:8px; padding:16px 26px 16px 16px; border-radius:18px;
  border:1px solid rgb(var(--primary) / 0.32); background: rgb(var(--primary) / 0.07);
  box-shadow: 0 16px 40px -16px rgb(0 0 0 / 0.6), inset 0 0 40px -28px rgb(var(--primary-soft)); animation: rcw-boot-fadein .5s ease both; }
.rcw-boot-agent { width:104px; height:104px; border-radius:16px; object-fit:cover; border:2px solid rgb(var(--primary) / 0.65);
  box-shadow:0 0 26px -6px rgb(var(--primary-soft)); background:#05090d; }
.rcw-boot-agent.ph { display:flex; align-items:center; justify-content:center; font-size:48px; color: rgb(var(--primary-soft) / 0.5); }
.rcw-boot-chip { font-family:var(--font-mono); font-size:10px; letter-spacing:.16em; padding:3px 10px; border-radius:999px;
  border:1px solid rgb(224 162 74 / 0.5); color:#e0a24a; }
.rcw-boot-chip.alt { border-color: rgb(var(--primary) / 0.5); color: rgb(var(--primary-soft)); }
.rcw-boot-h1.rcw-glitch { border-color: transparent; color: transparent; }
.rcw-boot-h1.rcw-glitch::before, .rcw-boot-h1.rcw-glitch::after {
  content: attr(data-text); position:absolute; left:0; right:0; top:0; }
.rcw-boot-h1.rcw-glitch::before { color: rgb(var(--primary-soft)); clip-path: polygon(0 0, 100% 0, 100% 46%, 0 46%);
  animation: rcw-derez-top 52ms linear infinite alternate-reverse; }
.rcw-boot-h1.rcw-glitch::after { color: rgb(var(--accent)); clip-path: polygon(0 54%, 100% 54%, 100% 100%, 0 100%);
  animation: rcw-derez-bot 52ms linear infinite alternate-reverse; }

.rcw-boot-foot { position:relative; z-index:2; padding: 12px 28px 22px; }
`;

export default function BootScreen() {
  const error = useStore((s) => s.error);
  const refresh = useStore((s) => s.refresh);
  const authRejected = /\b(401|403)\b/.test(error ?? "") || /unauthor/i.test(error ?? "");
  const signInAgain = () => { window.cowork.clearConfig().then(() => window.location.reload()).catch(() => window.location.reload()); };
  const failed = !!error;

  const [log, setLog] = useState<Line[]>([]);
  const [phase, setPhase] = useState<"log" | "title">("log");
  const [glitch, setGlitch] = useState(false);
  const [flash, setFlash] = useState(false);
  const [agent, setAgent] = useState<{ name: string; username: string; photo: string | null; rank: string; division: string; role: string } | null>(null);

  // Who's logging in — for the "ACCESS GRANTED · welcome" splash.
  useEffect(() => {
    let alive = true;
    window.cowork.accountsMe().then((m) => {
      if (alive && m && "username" in m && m.username) {
        const a = m as { displayName: string; username: string; photo?: string | null; level?: string; division?: string; role: string };
        setAgent({
          name: a.displayName || a.username, username: a.username, photo: a.photo ?? null,
          rank: a.level || (a.role === "admin" ? "General" : "Recruit"), division: a.division ?? "", role: a.role,
        });
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const iRef = useRef(0);
  const done = useRef(false);
  const accent = failed ? "#e0736a" : "rgb(var(--accent))";

  // Boot chime — once per launch, at the very start of the sequence.
  useEffect(() => {
    if (!bootChimePlayed) { bootChimePlayed = true; playSfx("boot"); }
  }, []);

  // Boot log types out → the title fades in GLITCHING (leading up to the beat) → at
  // IMPACT_MS, the "dang" hit in edex-theme.wav (~1.59s in, measured), the screen
  // FLASHES and the glitch SETTLES to a clean static title, which then holds for ~3s
  // (the Cockpit min-hold) before the cockpit loads in. Freezes on error.
  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const TITLE_MS = 850;    // title appears (glitching) during the log
    const IMPACT_MS = 1590;  // the "dang" hit — flash lands here
    const SETTLE_MS = 2280;  // glitch keeps running THROUGH the dang, then resolves
    const step = () => {
      if (cancelled || done.current) return;
      const i = iRef.current;
      if (i >= BOOT_LOG.length) return;
      iRef.current = i + 1;
      setLog((cur) => [...cur, BOOT_LOG[i]]);
      timer = setTimeout(step, BOOT_LOG[i].d);
    };
    step();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    // The title fades in and glitches CONTINUOUSLY (no calm before the beat, so it's
    // never static when the dang lands), FLASHES on the dang, then resolves to a clean
    // static logo shortly after — with margin for audio-start latency.
    at(TITLE_MS, () => { done.current = true; setPhase("title"); setGlitch(true); });
    at(IMPACT_MS, () => setFlash(true));            // flash on the dang; glitch still running
    at(IMPACT_MS + 520, () => setFlash(false));
    at(SETTLE_MS, () => setGlitch(false));          // resolve to clean static after the dang
    return () => { cancelled = true; clearTimeout(timer); timers.forEach(clearTimeout); };
  }, [failed]);

  // Keep retrying on a NETWORK/server error so the app recovers when it's back. Don't
  // auto-retry an auth rejection — the token won't fix itself.
  useEffect(() => {
    if (!failed || authRejected) return;
    const t = setInterval(() => refresh(), 5000);
    return () => clearInterval(t);
  }, [failed, authRejected, refresh]);

  const showTitle = phase === "title" && !failed;

  return (
    <div className="rcw-boot">
      <style>{CSS}</style>
      <span className="rcw-boot-grid" />
      <span className="rcw-boot-scan" />
      {flash && <div className="rcw-flash-overlay" />}

      {showTitle ? (
        <div className="rcw-boot-titlewrap">
          <img src={yiaSealUrl} alt="" className="rcw-boot-seal" />
          <h1 className={`rcw-boot-h1${glitch ? " rcw-glitch" : ""}`} data-text="YITEC INTELLIGENCE AGENCY">YITEC INTELLIGENCE AGENCY</h1>
          <div className="rcw-boot-access">◈ ACCESS GRANTED</div>
          {agent && (() => {
            const rk = findRank(agent.rank);
            return (
              <div className="rcw-boot-welcome">
                {agent.photo ? <img src={agent.photo} alt="" className="rcw-boot-agent" /> : <div className="rcw-boot-agent ph">◍</div>}
                <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: "0.34em", color: "rgb(var(--primary-soft))" }}>
                    WELCOME {agent.role === "admin" ? "DIRECTOR" : "AGENT"}
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.02em", color: "#e6f2f4", lineHeight: 1.05 }}>{agent.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.12em" }}>@{agent.username}</div>
                  {rk?.insignia && <div style={{ fontSize: 14, letterSpacing: "0.24em", color: "#ffd166", marginTop: 2 }}>{rk.insignia}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <span className="rcw-boot-chip">★ {agent.rank}</span>
                    {agent.division && <span className="rcw-boot-chip alt">◈ {agent.division}</span>}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="rcw-boot-log">
          {log.map((l, i) => (
            <div key={i} className={`l ${l.k}`}>{l.t}</div>
          ))}
          {!failed && (
            <div className="l hl">
              {"[sync] establishing uplink"}<span style={{ animation: "rcw-boot-caret 1s step-end infinite" }}> █</span>
            </div>
          )}
        </div>
      )}

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
                onClick={() => { iRef.current = 0; setLog([]); setPhase("log"); setGlitch(false); refresh(); }}
                className={authRejected ? "" : "glass-btn--clay"}
                style={{ padding: "9px 20px", fontSize: 13, fontWeight: 600, ...(authRejected ? { background: "transparent", border: "1px solid var(--border)", color: "var(--text-soft)", borderRadius: 10, cursor: "pointer" } : {}) }}
              >
                ↻ Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="mono" style={{ fontSize: 11, color: showTitle ? accent : "var(--text-faint)", letterSpacing: "0.14em", textTransform: "uppercase", transition: "color .3s" }}>
            {showTitle ? "◈ uplink established" : "Connecting to cowork…"}
          </div>
        )}
      </div>
    </div>
  );
}
