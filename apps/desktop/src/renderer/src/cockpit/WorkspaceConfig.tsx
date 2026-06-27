import { useEffect, useState } from "react";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
  kind: "terminal" | "browser";
}

function parsePorts(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--text-faint)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
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

export default function WorkspaceConfig({ sessionId, cwd, machine, kind }: Props) {
  const [sshHost, setSshHost] = useState("");
  const [portsText, setPortsText] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");
  const [existed, setExisted] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    window.cowork
      .getWorkspaceConfig({ sessionId, cwd, machine })
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setExisted(true);
        setSshHost(cfg.sshHost ?? "");
        setPortsText((cfg.forwardPorts ?? []).join(", "));
        setBrowserUrl(cfg.browserUrl ?? "");
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
      const config = {
        sshHost: sshHost.trim(),
        forwardPorts: parsePorts(portsText),
        browserUrl: browserUrl.trim(),
      };
      const res = await window.cowork.saveWorkspaceConfig({ sessionId, cwd, machine, config });
      if (res.ok) {
        setExisted(true);
        setStatus({ kind: "ok", text: "✓ saved" });
      } else {
        setStatus({ kind: "err", text: res.error ?? "save failed" });
      }
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const kindLabel = kind === "terminal" ? "Terminal" : "Browser";

  return (
    <div style={{ padding: "18px 32px 24px", overflowY: "auto", flex: 1 }} className="no-scrollbar">
      <div
        className="glass-inset"
        style={{ padding: "20px 22px", borderRadius: 16, maxWidth: 520 }}
      >
        <h3
          className="display"
          style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px", lineHeight: 1.1 }}
        >
          Configure {kindLabel}
        </h3>
        <p className="soft" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "0 0 20px" }}>
          Saved to <span className="mono">.redstone/session.json</span> in the project folder.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>SSH host / alias</label>
            <input
              className="reply-input"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              placeholder="contabo2 — leave blank for a local session"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Ports to forward</label>
            <input
              className="reply-input"
              value={portsText}
              onChange={(e) => setPortsText(e.target.value)}
              placeholder="5173, 8080"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Browser URL</label>
            <input
              className="reply-input"
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              placeholder="http://localhost:5173"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22 }}>
          <button
            className="glass-btn--clay"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "9px 20px", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {status && (
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: status.kind === "ok" ? "rgb(var(--accent))" : "#e0736a",
              }}
            >
              {status.text}
            </span>
          )}
        </div>

        {existed && (
          <p className="faint" style={{ fontSize: 11, lineHeight: 1.5, margin: "18px 0 0" }}>
            Configured. {kindLabel} content arrives in the next increment.
          </p>
        )}
      </div>
    </div>
  );
}
