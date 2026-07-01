import { useEffect, useState } from "react";

interface LoginProps {
  onConnected: () => void;
}

type Mode = "token" | "redstone";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid var(--border, rgba(255,255,255,0.12))",
  background: "rgba(255,255,255,.03)",
  color: "inherit",
  fontSize: 14,
  outline: "none",
};

export default function Login({ onConnected }: LoginProps) {
  const [serverUrl, setServerUrl] = useState("https://cowork.example.com");
  const [mode, setMode] = useState<Mode>("token");
  const [redstoneOn, setRedstoneOn] = useState(false);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  // Ask the server (as the URL changes) whether it offers Redstone org sign-in.
  useEffect(() => {
    const url = serverUrl.trim();
    if (!url) { setRedstoneOn(false); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      window.cowork.authConfig(url).then((c) => {
        if (cancelled) return;
        setRedstoneOn(!!c.redstone);
        if (c.redstone) setMode("redstone");
      }).catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [serverUrl]);

  const canSubmit =
    serverUrl.trim().length > 0 &&
    !connecting &&
    (mode === "token" ? token.trim().length > 0 : username.trim().length > 0 && password.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setConnecting(true);
    setError("");
    try {
      if (mode === "redstone") {
        const r = await window.cowork.redstoneLogin(serverUrl.trim(), username.trim(), password);
        if (r.ok) return onConnected();
        setError(r.error ?? "Sign-in failed.");
      } else {
        await window.cowork.saveConfig(serverUrl.trim(), token.trim());
        onConnected();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600, textAlign: "center", cursor: "pointer",
    borderRadius: 9, border: 0,
    background: active ? "rgba(var(--primary), 0.2)" : "transparent",
    color: active ? "inherit" : "var(--text-soft, rgba(255,255,255,0.55))",
  });

  return (
    <div data-app className="grain" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="atmosphere">
        <div className="blob blob--a" />
        <div className="blob blob--b" />
        <div className="blob blob--c" />
      </div>

      <div className="glass-surface" style={{ position: "relative", zIndex: 2, width: 420, padding: "40px 36px", borderRadius: 18 }}>
        <span className="kicker" style={{ display: "block", marginBottom: 10 }}>Connect</span>
        <h2 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 24px", color: "rgb(var(--text-primary, 255 245 230))" }}>
          Connect to your cowork server
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Server URL</label>
            <input type="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://cowork.example.com" style={inputStyle} />
          </div>

          {redstoneOn && (
            <div style={{ display: "flex", gap: 6, padding: 4, marginBottom: 18, border: "1px solid var(--border, rgba(255,255,255,0.12))", borderRadius: 11 }}>
              <button type="button" style={tabStyle(mode === "redstone")} onClick={() => { setMode("redstone"); setError(""); }}>Organization</button>
              <button type="button" style={tabStyle(mode === "token")} onClick={() => { setMode("token"); setError(""); }}>Personal</button>
            </div>
          )}

          {mode === "redstone" && redstoneOn ? (
            <>
              <div style={{ marginBottom: 14 }}>
                <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Redstone username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@yourorg" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your Redstone password" autoComplete="current-password" style={inputStyle} />
              </div>
            </>
          ) : (
            <div style={{ marginBottom: 24 }}>
              <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Instance token</label>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Your INSTANCE_TOKEN" style={inputStyle} />
            </div>
          )}

          <button type="submit" className="glass-btn--clay" disabled={!canSubmit}
            style={{ width: "100%", padding: "13px 0", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.5, border: "none" }}>
            {connecting ? (mode === "redstone" ? "Signing in…" : "Connecting…") : mode === "redstone" ? "Sign in with Redstone" : "Connect"}
          </button>
          {error && <p className="mono" style={{ color: "#e0736a", fontSize: 12.5, marginTop: 14 }}>{error}</p>}
        </form>
      </div>
    </div>
  );
}
