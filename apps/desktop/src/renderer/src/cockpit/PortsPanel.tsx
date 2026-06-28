import { useEffect, useRef, useState } from "react";
import ConnectionBar from "./ConnectionBar";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
}

type ForwardStatus = "local" | "starting" | "active" | "failed" | "stopped";

const CHIP: Record<ForwardStatus, { label: string; color: string; bg: string }> = {
  local: { label: "local", color: "var(--text-soft)", bg: "rgba(255,255,255,0.06)" },
  starting: { label: "starting", color: "#e6b450", bg: "rgba(230,180,80,0.12)" },
  active: { label: "active", color: "rgb(var(--accent))", bg: "rgba(var(--accent),0.14)" },
  failed: { label: "failed", color: "#e0736a", bg: "rgba(224,115,106,0.12)" },
  stopped: { label: "off", color: "var(--text-soft)", bg: "rgba(255,255,255,0.04)" },
};

export default function PortsPanel({ sessionId, cwd, machine }: Props) {
  const [browserUrl, setBrowserUrl] = useState("");
  const [forwardPorts, setForwardPorts] = useState<number[]>([]);
  const [portInput, setPortInput] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Live per-port forward status, keyed by port.
  const [fwd, setFwd] = useState<Record<number, { status: ForwardStatus; error?: string }>>({});
  // Latest browserUrl for persist() without re-running effects.
  const browserUrlRef = useRef("");
  browserUrlRef.current = browserUrl;

  // Subscribe to live status pushes (filtered by sessionId).
  useEffect(() => {
    const unsub = window.cowork.onForwardStatus((a) => {
      if (a.sessionId !== sessionId) return;
      setFwd((prev) => ({ ...prev, [a.port]: { status: a.status as ForwardStatus, error: a.error } }));
    });
    return unsub;
  }, [sessionId]);

  // Load config, seed forward statuses, auto-start any not-yet-forwarding ports.
  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setLoaded(false);
    setFwd({});
    Promise.all([
      window.cowork.getWorkspaceConfig({ sessionId, cwd, machine }),
      window.cowork.listForwards(sessionId),
    ])
      .then(([cfg, existing]) => {
        if (cancelled) return;
        const ports = cfg?.forwardPorts ?? [];
        setBrowserUrl(cfg?.browserUrl ?? "");
        setForwardPorts(ports);
        const seeded: Record<number, { status: ForwardStatus; error?: string }> = {};
        for (const f of existing) seeded[f.port] = { status: f.status as ForwardStatus, error: f.error };
        setFwd(seeded);
        setLoaded(true);
        // Auto-start forwards for ports that aren't already managed.
        for (const p of ports) {
          if (!seeded[p]) {
            window.cowork.startForward({ sessionId, machine, port: p }).catch(() => {/* ignore */});
          }
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, cwd, machine]);

  async function persist(ports: number[]) {
    setStatus(null);
    try {
      const res = await window.cowork.saveWorkspaceConfig({
        sessionId,
        cwd,
        machine,
        config: { forwardPorts: ports, browserUrl: browserUrlRef.current },
      });
      if (res.ok) setStatus({ kind: "ok", text: "✓ saved" });
      else setStatus({ kind: "err", text: res.error ?? "save failed" });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }

  function addPort() {
    const n = Number.parseInt(portInput.trim(), 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setStatus({ kind: "err", text: "port must be 1–65535" });
      return;
    }
    if (forwardPorts.includes(n)) {
      setPortInput("");
      return;
    }
    const next = [...forwardPorts, n];
    setForwardPorts(next);
    setPortInput("");
    persist(next);
    window.cowork.startForward({ sessionId, machine, port: n }).catch(() => {/* ignore */});
  }

  function removePort(n: number) {
    const next = forwardPorts.filter((p) => p !== n);
    setForwardPorts(next);
    setFwd((prev) => {
      const { [n]: _drop, ...rest } = prev;
      return rest;
    });
    window.cowork.stopForward({ sessionId, port: n }).catch(() => {/* ignore */});
    persist(next);
  }

  function startOne(n: number) {
    setFwd((prev) => ({ ...prev, [n]: { status: "starting" } }));
    window.cowork.startForward({ sessionId, machine, port: n }).catch(() => {/* ignore */});
  }

  function stopOne(n: number) {
    window.cowork.stopForward({ sessionId, port: n }).catch(() => {/* ignore */});
    setFwd((prev) => ({ ...prev, [n]: { status: "stopped" } }));
  }

  // The ssh host changed — re-spawn every tunnel against the new host.
  function restartForwards() {
    for (const p of forwardPorts) {
      window.cowork.stopForward({ sessionId, port: p }).catch(() => {/* ignore */});
      window.cowork.startForward({ sessionId, machine, port: p }).catch(() => {/* ignore */});
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ConnectionBar sessionId={sessionId} machine={machine} onHostChange={restartForwards} />
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 32px 24px" }} className="no-scrollbar">
        <div
          className="glass-inset"
          style={{ padding: "20px 22px", borderRadius: 16, maxWidth: 560 }}
        >
          <h3
            className="display"
            style={{ fontSize: 22, fontWeight: 400, margin: "0 0 14px", lineHeight: 1.1 }}
          >
            Ports
          </h3>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              className="reply-input"
              type="number"
              min={1}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addPort();
              }}
              placeholder="5173"
              style={{
                width: 140,
                borderRadius: 12,
                border: "1px solid var(--border)",
                padding: "10px 13px",
                color: "var(--text)",
                caretColor: "rgb(var(--primary-soft))",
                fontSize: 13,
                background: "rgba(255,255,255,0.03)",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
            <button
              className="glass-btn--clay"
              onClick={addPort}
              style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600 }}
            >
              Add
            </button>
            {status && (
              <span
                className="mono"
                style={{ fontSize: 11, color: status.kind === "ok" ? "rgb(var(--accent))" : "#e0736a" }}
              >
                {status.text}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
            {loaded && forwardPorts.length === 0 && (
              <span className="faint" style={{ fontSize: 12, fontStyle: "italic" }}>
                No ports forwarded yet.
              </span>
            )}
            {forwardPorts.map((p) => {
              const st = fwd[p]?.status ?? "stopped";
              const chip = CHIP[st];
              const running = st === "starting" || st === "active" || st === "local";
              return (
                <div
                  key={p}
                  className="glass-inset mono"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                    color: "var(--text)",
                    padding: "8px 10px 8px 14px",
                    borderRadius: 12,
                  }}
                >
                  <span style={{ minWidth: 52, fontVariantNumeric: "tabular-nums" }}>{p}</span>
                  <span
                    title={fwd[p]?.error}
                    style={{
                      fontSize: 10.5,
                      letterSpacing: 0.3,
                      color: chip.color,
                      background: chip.bg,
                      borderRadius: 999,
                      padding: "2px 9px",
                      textTransform: "uppercase",
                    }}
                  >
                    {chip.label}
                  </span>
                  <span style={{ flex: 1 }} />
                  {st !== "local" && (
                    <button
                      onClick={() => (running ? stopOne(p) : startOne(p))}
                      title={running ? `Stop forwarding ${p}` : `Start forwarding ${p}`}
                      style={toggleBtn}
                    >
                      {running ? "Stop" : "Start"}
                    </button>
                  )}
                  <button
                    onClick={() => removePort(p)}
                    title={`Remove ${p}`}
                    style={{
                      border: 0,
                      background: "rgba(255,255,255,0.06)",
                      color: "var(--text-soft)",
                      borderRadius: 999,
                      width: 20,
                      height: 20,
                      lineHeight: "18px",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <p className="faint" style={{ fontSize: 11, lineHeight: 1.5, margin: "18px 0 0" }}>
            Each port runs <span className="mono">ssh -N -L</span> to the host. Local sessions need no
            forwarding.
          </p>
        </div>
      </div>
    </div>
  );
}

const toggleBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-soft)",
  borderRadius: 8,
  padding: "3px 12px",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
};
