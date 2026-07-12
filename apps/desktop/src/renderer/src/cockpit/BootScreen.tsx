import { useEffect, useState } from "react";
import { useStore } from "../store";

// The boot sequence shown until the FIRST session fetch succeeds. It doubles as an
// honest connection monitor: while connecting it animates through boot steps; if the
// fetch fails it stops on the failing step and shows the REAL reason + a retry — so a
// connection error is never masked by a misleading "All clear" empty state.

const STEPS = [
  "initializing cockpit core",
  "spinning up render pipeline",
  "establishing uplink to cowork server",
  "authenticating instance",
  "fetching active sessions",
];

// req() surfaces bare HTTP statuses ("500") and fetch failures ("Failed to fetch").
// Make them human without losing the detail.
function humanizeError(e: string): string {
  const s = (e || "").trim();
  if (/^\d{3}$/.test(s)) {
    const code = Number(s);
    if (code === 401 || code === 403) return `Server rejected the instance token (HTTP ${code}). Re-check your login / token.`;
    if (code === 502 || code === 503 || code === 504) return `Cowork server is unreachable or restarting (HTTP ${code}).`;
    return `Cowork server responded HTTP ${code}.`;
  }
  if (/failed to fetch|networkerror|econnrefused|fetch failed/i.test(s)) return "Can't reach the cowork server — network down, server offline, or the web proxy hasn't reconnected.";
  return s || "Unknown connection error.";
}

const CSS = `
@keyframes rcw-boot-spin { to { transform: rotate(360deg); } }
@keyframes rcw-boot-pulse { 0%,100% { transform: scale(1); opacity: .55; } 50% { transform: scale(1.14); opacity: 1; } }
@keyframes rcw-boot-ring { 0% { transform: scale(.6); opacity: .5; } 100% { transform: scale(1.7); opacity: 0; } }
@keyframes rcw-boot-caret { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes rcw-boot-scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(2200%); } }
`;

export default function BootScreen() {
  const error = useStore((s) => s.error);
  const refresh = useStore((s) => s.refresh);
  // Advance the visible boot steps on a timer while connecting; freeze at the last
  // reached step if the connection errors (that's the step that failed).
  const [step, setStep] = useState(0);
  const failed = !!error;

  useEffect(() => {
    if (failed) return; // stop advancing — the current step is where it broke
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 520);
    return () => clearInterval(t);
  }, [failed]);

  // While failed, keep retrying in the background so the app recovers on its own the
  // moment the server/proxy comes back — no need to sit on the manual button.
  useEffect(() => {
    if (!failed) return;
    const t = setInterval(() => refresh(), 5000);
    return () => clearInterval(t);
  }, [failed, refresh]);

  const accent = failed ? "#e0736a" : "rgb(var(--accent))";

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <style>{CSS}</style>
      {/* faint scanline sweep */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 40, background: `linear-gradient(var(--app-panel), transparent)`, opacity: 0.06, animation: "rcw-boot-scan 6s linear infinite", pointerEvents: "none" }} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, maxWidth: 520, padding: 24 }}>
        {/* orbital core — pulsing rings + rotating dashed orbit + glowing core */}
        <div style={{ position: "relative", width: 132, height: 132, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px solid ${accent}`, animation: `rcw-boot-ring 2.6s ease-out ${i * 0.85}s infinite` }} />
          ))}
          <span style={{ position: "absolute", inset: 8, borderRadius: "50%", border: `2px dashed ${accent}`, opacity: 0.5, animation: failed ? "none" : "rcw-boot-spin 7s linear infinite" }} />
          <span style={{ position: "absolute", inset: 30, borderRadius: "50%", border: `1px solid ${accent}`, opacity: 0.3, animation: failed ? "none" : "rcw-boot-spin 4s linear infinite reverse" }} />
          <span style={{ width: 30, height: 30, borderRadius: "50%", background: accent, boxShadow: `0 0 26px 4px ${accent}`, animation: failed ? "none" : "rcw-boot-pulse 2s ease-in-out infinite" }} />
        </div>

        {/* boot log */}
        <div className="mono" style={{ width: "100%", fontSize: 12, lineHeight: 1.9, color: "var(--text-soft)" }}>
          {STEPS.map((label, i) => {
            const reached = i <= step;
            const isFail = failed && i === step;
            const done = i < step || (!failed && i === step && step === STEPS.length - 1);
            return (
              <div key={i} style={{ opacity: reached ? 1 : 0.25, display: "flex", alignItems: "center", gap: 8, transition: "opacity .3s" }}>
                <span style={{ width: 14, color: isFail ? "#e0736a" : done ? "rgb(var(--accent))" : "var(--text-faint)" }}>
                  {isFail ? "✗" : done ? "✓" : reached ? "▸" : "·"}
                </span>
                <span style={{ color: isFail ? "#e0736a" : "var(--text-soft)" }}>{label}</span>
                {reached && !done && !isFail && <span style={{ animation: "rcw-boot-caret 1s step-end infinite", color: accent }}>_</span>}
              </div>
            );
          })}
        </div>

        {/* status / error */}
        {failed ? (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <div className="mono" style={{ fontSize: 12.5, color: "#e0736a", fontWeight: 600, letterSpacing: "0.06em" }}>◈ UPLINK FAILED</div>
            <p style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6, margin: 0, maxWidth: 440 }}>{humanizeError(error)}</p>
            <button
              onClick={() => { setStep(0); refresh(); }}
              className="glass-btn--clay"
              style={{ padding: "9px 20px", fontSize: 13, fontWeight: 600 }}
            >
              ↻ Retry connection
            </button>
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
