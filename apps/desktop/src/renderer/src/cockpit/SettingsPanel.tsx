import { useEffect, useState } from "react";
import { useStore } from "../store";

/**
 * Connection settings — reachable any time from the title bar. Lets the user see
 * which cowork server the app points at, change the server URL / access token,
 * reconnect, or sign out. (First-run uses the standalone Login screen; this is
 * the same config, editable after connecting.)
 */
export default function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const toggle = useStore((s) => s.toggleSettings);

  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "err"; text?: string }>({ kind: "idle" });

  // Load the current server URL each time the panel opens (token is never read back).
  useEffect(() => {
    if (!open) return;
    setStatus({ kind: "idle" });
    setToken("");
    window.cowork.getConfig().then((cfg) => setServerUrl(cfg?.serverUrl ?? "https://cowork.example.com"));
  }, [open]);

  if (!open) return null;

  async function saveAndReconnect() {
    const url = serverUrl.trim();
    if (!url) { setStatus({ kind: "err", text: "server URL is required" }); return; }
    if (!token.trim()) { setStatus({ kind: "err", text: "enter the access token to reconnect" }); return; }
    setStatus({ kind: "saving" });
    try {
      await window.cowork.saveConfig(url, token.trim());
      setStatus({ kind: "ok", text: "saved — reconnecting…" });
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function signOut() {
    await window.cowork.clearConfig();
    window.location.reload(); // App re-gates → Login screen
  }

  return (
    <div
      onClick={toggle}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="glass-soft"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: "92vw", borderRadius: 18, border: "1px solid var(--border-strong)", padding: "26px 28px" }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <span className="kicker">Connection</span>
          <span style={{ flex: 1 }} />
          <button onClick={toggle} title="Close" style={iconBtn}>✕</button>
        </div>
        <h2 className="display" style={{ fontSize: 24, margin: "0 0 18px" }}>Cowork server</h2>

        <label className="soft" style={labelStyle}>Server URL / hostname</label>
        <input
          type="url"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://cowork.example.com  or  http://192.168.1.10:47101"
          style={inputStyle}
        />
        <p className="faint" style={{ fontSize: 11, margin: "6px 2px 16px", lineHeight: 1.5 }}>
          The domain or IP:port where your cowork server is reachable. The app calls this for everything.
        </p>

        <label className="soft" style={labelStyle}>Access token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Your INSTANCE_TOKEN (paste to change / reconnect)"
          style={inputStyle}
        />
        <p className="faint" style={{ fontSize: 11, margin: "6px 2px 20px", lineHeight: 1.5 }}>
          The instance token from the server's <span className="mono">.env</span> — this is how the app authenticates.
        </p>

        {status.kind !== "idle" && (
          <div className="mono" style={{ fontSize: 11.5, marginBottom: 12, color: status.kind === "err" ? "#e0736a" : "rgb(var(--accent))" }}>
            {status.kind === "saving" ? "saving…" : status.text}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={saveAndReconnect} className="glass-btn--clay" style={{ padding: "11px 20px", fontSize: 14, fontWeight: 600 }}>
            Save & reconnect
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={signOut} style={{ ...iconBtn, width: "auto", padding: "8px 16px", borderRadius: 999, fontSize: 12.5, color: "#e0736a", borderColor: "rgba(224,115,106,0.4)" }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", marginBottom: 7, fontSize: 12.5 };
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10,
  border: "1px solid var(--border)", background: "rgba(255,255,255,.03)", color: "var(--text)",
  fontSize: 13.5, outline: "none", caretColor: "rgb(var(--primary-soft))",
};
const iconBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 12,
};
