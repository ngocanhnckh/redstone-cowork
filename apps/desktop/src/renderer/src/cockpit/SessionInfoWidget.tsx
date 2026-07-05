import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

const card: React.CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px",
  background: "rgb(var(--primary) / 0.03)", position: "relative", overflow: "hidden",
};

const TIME_KEY = "rcw.sessionTime"; // { [sessionId]: secondsSpent }

function loadTimes(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(TIME_KEY) || "{}"); } catch { return {}; }
}

/** Accumulate foreground time on the focused session (persisted, survives restart). */
function useSessionSeconds(focusId: string | null): number {
  const [times, setTimes] = useState<Record<string, number>>(loadTimes);
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  useEffect(() => {
    const t = setInterval(() => {
      const id = focusRef.current;
      if (!id || document.visibilityState !== "visible") return;
      setTimes((m) => {
        const next = { ...m, [id]: (m[id] ?? 0) + 1 };
        try { localStorage.setItem(TIME_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return focusId ? times[focusId] ?? 0 : 0;
}

function fmtHMS(total: number): string {
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const IpRow = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
    <span className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
    <span className="mono" style={{ fontSize: 12.5, color: value ? "var(--text)" : "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {value ?? "—"}
    </span>
  </div>
);

/**
 * Session-scoped uplink widget: the remote host's local + public IPv4, live time
 * spent on the focused session (foreground only), and this session's prompt count.
 */
export default function SessionInfoWidget() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const machine = session?.machine ?? null;

  const seconds = useSessionSeconds(focusId);
  const [ips, setIps] = useState<{ local: string | null; public: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  // Prompts sent in this session (user turns in the recent transcript).
  const prompts = session ? (session.transcript ?? []).filter((m) => m.role === "user").length : 0;

  const loadIps = () => {
    if (!machine) { setIps(null); return; }
    setLoading(true);
    window.cowork.hostIps(machine)
      .then((r) => setIps(r))
      .catch(() => setIps({ local: null, public: null }))
      .finally(() => setLoading(false));
  };
  // Refresh on host change and periodically (IPs rarely change).
  useEffect(() => { setIps(null); loadIps(); const t = setInterval(loadIps, 60_000); return () => clearInterval(t); }, [machine]);

  return (
    <div className="hud-card" style={{ ...card, containerType: "inline-size" }}>
      <span className="hud-corner" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="ai-core" style={{ width: 7, height: 7 }} />
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>
          Uplink{machine ? ` · ${machine}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={loadIps} disabled={!machine || loading} title="Refresh IPs"
          style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "1px 7px", fontSize: 10, cursor: machine ? "pointer" : "default" }}>
          {loading ? "…" : "↻"}
        </button>
      </div>

      {!session ? (
        <span className="mono faint" style={{ fontSize: 11 }}>no session selected</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <IpRow label="Local IP" value={ips?.local} />
          <IpRow label="Public IP" value={ips?.public} />
          <div style={{ height: 1, background: "var(--border)", margin: "3px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Time on session</div>
              <div style={{ fontSize: 16, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{fmtHMS(seconds)}</div>
            </div>
            <div title="User prompts in this session's recent transcript">
              <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Prompts</div>
              <div style={{ fontSize: 16, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{prompts}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
