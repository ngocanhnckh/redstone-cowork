import { useEffect, useState } from "react";
import { useStore } from "../store";
import AccessKeysManager from "./AccessKeysManager";

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
  const [mode, setMode] = useState<"token" | "redstone">("token");
  const [redstoneOn, setRedstoneOn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "err"; text?: string }>({ kind: "idle" });

  // Load the current server URL each time the panel opens (tokens are never read
  // back). Remember whether the current session is org (Redstone) and ask the
  // server whether it offers Redstone sign-in, so we can show the right controls.
  useEffect(() => {
    if (!open) return;
    setStatus({ kind: "idle" });
    setToken(""); setPassword(""); setUsername("");
    window.cowork.getConfig().then((cfg) => {
      const url = cfg?.serverUrl ?? "https://cowork.example.com";
      setServerUrl(url);
      setMode(cfg?.isOrg ? "redstone" : "token");
      window.cowork.authConfig(url).then((c) => setRedstoneOn(!!c.redstone)).catch(() => {});
    });
  }, [open]);

  if (!open) return null;

  async function saveAndReconnect() {
    const url = serverUrl.trim();
    if (!url) { setStatus({ kind: "err", text: "server URL is required" }); return; }
    setStatus({ kind: "saving" });
    try {
      if (mode === "redstone") {
        if (!username.trim() || !password) { setStatus({ kind: "err", text: "enter your Redstone username and password" }); return; }
        const r = await window.cowork.redstoneLogin(url, username.trim(), password);
        if (!r.ok) { setStatus({ kind: "err", text: r.error ?? "Redstone sign-in failed" }); return; }
      } else {
        if (!token.trim()) { setStatus({ kind: "err", text: "enter the access token to reconnect" }); return; }
        await window.cowork.saveConfig(url, token.trim());
      }
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
        className="glass-soft no-scrollbar"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", borderRadius: 18, border: "1px solid var(--border-strong)", padding: "26px 28px" }}
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

        {redstoneOn && (
          <div style={{ display: "flex", gap: 6, padding: 4, marginBottom: 16, border: "1px solid var(--border)", borderRadius: 11 }}>
            {(["redstone", "token"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setStatus({ kind: "idle" }); }}
                style={{
                  flex: 1, padding: "7px 0", fontSize: 12.5, fontWeight: 600, textAlign: "center", cursor: "pointer",
                  borderRadius: 8, border: 0,
                  background: mode === m ? "rgb(var(--primary) / 0.28)" : "transparent",
                  color: mode === m ? "#fff" : "var(--text-soft)",
                }}
              >
                {m === "redstone" ? "Organization" : "Personal"}
              </button>
            ))}
          </div>
        )}

        {mode === "redstone" && redstoneOn ? (
          <>
            <label className="soft" style={labelStyle}>Redstone username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@yourorg" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={{ ...inputStyle, marginBottom: 12 }} />
            <label className="soft" style={labelStyle}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your Redstone password" autoComplete="current-password" style={inputStyle} />
            <p className="faint" style={{ fontSize: 11, margin: "6px 2px 20px", lineHeight: 1.5 }}>
              Sign in with your organization&apos;s Redstone account. The password is exchanged for a token server-side and never stored here.
            </p>
          </>
        ) : (
          <>
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
          </>
        )}

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

        <AccessKeysManager />
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
