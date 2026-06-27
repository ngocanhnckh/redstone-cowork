import { useEffect, useState } from "react";
import ConnectionBar from "./ConnectionBar";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  borderRadius: 12,
  border: "1px solid var(--border)",
  padding: "10px 13px",
  color: "var(--text)",
  caretColor: "rgb(var(--primary-soft))",
  fontSize: 13,
  background: "rgba(255,255,255,0.03)",
  outline: "none",
  fontFamily: "var(--font-mono)",
};

export default function BrowserPanel({ sessionId, cwd, machine }: Props) {
  const [browserUrl, setBrowserUrl] = useState("");
  const [forwardPorts, setForwardPorts] = useState<number[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    window.cowork
      .getWorkspaceConfig({ sessionId, cwd, machine })
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setBrowserUrl(cfg.browserUrl ?? "");
        setForwardPorts(cfg.forwardPorts ?? []);
      })
      .catch(() => {
        /* ignore — treat as unconfigured */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, cwd, machine]);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      const config = { forwardPorts, browserUrl: browserUrl.trim() };
      const res = await window.cowork.saveWorkspaceConfig({ sessionId, cwd, machine, config });
      if (res.ok) setStatus({ kind: "ok", text: "✓ saved" });
      else setStatus({ kind: "err", text: res.error ?? "save failed" });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ConnectionBar machine={machine} />
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 32px 24px" }} className="no-scrollbar">
        <div
          className="glass-inset"
          style={{ padding: "20px 22px", borderRadius: 16, maxWidth: 560 }}
        >
          <h3
            className="display"
            style={{ fontSize: 22, fontWeight: 400, margin: "0 0 14px", lineHeight: 1.1 }}
          >
            Browser
          </h3>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              className="reply-input"
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              placeholder="http://localhost:5173"
              style={inputStyle}
            />
            <button
              className="glass-btn--clay"
              onClick={handleSave}
              disabled={saving}
              style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Go"}
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

          <p className="faint" style={{ fontSize: 11, lineHeight: 1.5, margin: "18px 0 0" }}>
            The live Chromium preview arrives in the next increment.
          </p>
        </div>
      </div>
    </div>
  );
}
