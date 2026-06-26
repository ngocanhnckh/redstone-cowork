import { useState } from "react";

interface LoginProps {
  onConnected: () => void;
}

export default function Login({ onConnected }: LoginProps) {
  const [serverUrl, setServerUrl] = useState("https://cowork.example.com");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);

  const canSubmit = serverUrl.trim().length > 0 && token.trim().length > 0 && !connecting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setConnecting(true);
    try {
      await window.cowork.saveConfig(serverUrl.trim(), token.trim());
      onConnected();
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div
      data-app
      className="grain"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div className="atmosphere">
        <div className="blob blob--a" />
        <div className="blob blob--b" />
        <div className="blob blob--c" />
      </div>

      <div
        className="glass-surface"
        style={{
          position: "relative",
          zIndex: 2,
          width: 420,
          padding: "40px 36px",
          borderRadius: 18,
        }}
      >
        <span className="kicker" style={{ display: "block", marginBottom: 10 }}>
          Connect
        </span>
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 28px",
            color: "rgb(var(--text-primary, 255 245 230))",
          }}
        >
          Connect to your cowork server
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label
              className="soft"
              style={{ display: "block", marginBottom: 6, fontSize: 13 }}
            >
              Server URL
            </label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://cowork.example.com"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border, rgba(255,255,255,0.12))",
                background: "rgba(255,255,255,.03)",
                color: "inherit",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 28 }}>
            <label
              className="soft"
              style={{ display: "block", marginBottom: 6, fontSize: 13 }}
            >
              Instance Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Your INSTANCE_TOKEN"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border, rgba(255,255,255,0.12))",
                background: "rgba(255,255,255,.03)",
                color: "inherit",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>

          <button
            type="submit"
            className="glass-btn--clay"
            disabled={!canSubmit}
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.5,
              border: "none",
            }}
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}
