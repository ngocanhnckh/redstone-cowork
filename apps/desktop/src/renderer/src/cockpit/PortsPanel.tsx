import { useEffect, useState } from "react";
import ConnectionBar from "./ConnectionBar";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
}

export default function PortsPanel({ sessionId, cwd, machine }: Props) {
  const [browserUrl, setBrowserUrl] = useState("");
  const [forwardPorts, setForwardPorts] = useState<number[]>([]);
  const [portInput, setPortInput] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    window.cowork
      .getWorkspaceConfig({ sessionId, cwd, machine })
      .then((cfg) => {
        if (cancelled) return;
        if (cfg) {
          setBrowserUrl(cfg.browserUrl ?? "");
          setForwardPorts(cfg.forwardPorts ?? []);
        }
        setLoaded(true);
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
        config: { forwardPorts: ports, browserUrl },
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
  }

  function removePort(n: number) {
    const next = forwardPorts.filter((p) => p !== n);
    setForwardPorts(next);
    persist(next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ConnectionBar machine={machine} />
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 32px 24px" }} className="no-scrollbar">
        <div
          className="glass-inset"
          style={{ padding: "20px 22px", borderRadius: 16, maxWidth: 520 }}
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

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            {loaded && forwardPorts.length === 0 && (
              <span className="faint" style={{ fontSize: 12, fontStyle: "italic" }}>
                No ports forwarded yet.
              </span>
            )}
            {forwardPorts.map((p) => (
              <span
                key={p}
                className="glass-inset mono"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text)",
                  padding: "6px 8px 6px 12px",
                  borderRadius: 999,
                }}
              >
                {p}
                <button
                  onClick={() => removePort(p)}
                  title={`Remove ${p}`}
                  style={{
                    border: 0,
                    background: "rgba(255,255,255,0.06)",
                    color: "var(--text-soft)",
                    borderRadius: 999,
                    width: 18,
                    height: 18,
                    lineHeight: "16px",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <p className="faint" style={{ fontSize: 11, lineHeight: 1.5, margin: "18px 0 0" }}>
            Forwarding actually starts in the next increment.
          </p>
        </div>
      </div>
    </div>
  );
}
