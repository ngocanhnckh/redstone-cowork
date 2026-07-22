import { useEffect, useState } from "react";
import { useStore } from "./store";

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

  // Offline mode (direct SSH, no cowork server): pick one or more hosts to scan.
  const enterOffline = useStore((s) => s.enterOffline);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selected, setSelected] = useState<OfflineHost[]>([]);
  const [manual, setManual] = useState("");

  // On opening the offline picker, load ~/.ssh/config aliases + any saved hosts.
  useEffect(() => {
    if (!offlineOpen) return;
    window.cowork.offlineSshConfig().then(setCandidates).catch(() => {});
    window.cowork.offlineHostsList().then((h) => { if (h.length) setSelected(h); }).catch(() => {});
  }, [offlineOpen]);

  const addHost = (target: string) => {
    const t = target.trim();
    if (!t) return;
    setSelected((prev) => (prev.some((h) => h.host === t || h.alias === t) ? prev : [...prev, { alias: t, host: t }]));
  };
  const removeHost = (alias: string) => setSelected((prev) => prev.filter((h) => h.alias !== alias));

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
        // A server_error / 5xx usually means the Redstone identity provider is down or
        // misconfigured (not your credentials) — nudge to the working Personal path.
        const msg = r.error ?? "Sign-in failed.";
        setError(/server[_ ]?error|unexpected|500|502|503|504/i.test(msg)
          ? `${msg} — the Redstone sign-in service looks unavailable. Use the “Personal” tab with your instance token instead.`
          : msg);
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

        {/* ---- Offline mode: drive Claude sessions on remote hosts over plain SSH ---- */}
        <div style={{ marginTop: 26, paddingTop: 22, borderTop: "1px solid var(--border, rgba(255,255,255,0.12))" }}>
          {!offlineOpen ? (
            <button
              type="button"
              onClick={() => setOfflineOpen(true)}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "transparent", color: "inherit",
              }}
            >
              Work offline (direct SSH) →
            </button>
          ) : (
            <>
              <span className="kicker" style={{ display: "block", marginBottom: 8 }}>Work offline · direct SSH</span>
              <p className="soft" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px" }}>
                No cowork server — discover and answer Claude sessions running in tmux on hosts you can reach over SSH.
              </p>

              {candidates.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 12.5 }}>From your ~/.ssh/config</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {candidates.map((c) => {
                      const on = selected.some((h) => h.alias === c || h.host === c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => (on ? removeHost(c) : addHost(c))}
                          style={{
                            padding: "4px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                            border: "1px solid var(--border, rgba(255,255,255,0.12))",
                            background: on ? "rgba(var(--primary), 0.22)" : "transparent",
                            color: "inherit", fontFamily: "var(--font-mono)",
                          }}
                        >
                          {on ? "✓ " : ""}{c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 12.5 }}>Add a host</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHost(manual); setManual(""); } }}
                    placeholder="alias / user@host"
                    autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => { addHost(manual); setManual(""); }}
                    style={{
                      padding: "0 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                      border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "transparent", color: "inherit",
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {selected.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                  {selected.map((h) => (
                    <span
                      key={h.alias}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 10px", borderRadius: 999,
                        fontSize: 12, fontFamily: "var(--font-mono)", background: "rgba(var(--primary), 0.18)",
                        border: "1px solid var(--border, rgba(255,255,255,0.12))",
                      }}
                    >
                      {h.alias}
                      <button
                        type="button"
                        onClick={() => removeHost(h.alias)}
                        title="Remove"
                        style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => enterOffline(selected)}
                  disabled={selected.length === 0}
                  className="glass-btn--clay"
                  style={{
                    flex: 1, padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 600, border: "none",
                    cursor: selected.length ? "pointer" : "not-allowed", opacity: selected.length ? 1 : 0.5,
                  }}
                >
                  Connect offline{selected.length ? ` · ${selected.length} host${selected.length > 1 ? "s" : ""}` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => setOfflineOpen(false)}
                  style={{
                    padding: "0 16px", borderRadius: 10, fontSize: 13, cursor: "pointer",
                    border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "transparent", color: "var(--text-soft, rgba(255,255,255,0.55))",
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
