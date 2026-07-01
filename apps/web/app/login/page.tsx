"use client";
import { useEffect, useState } from "react";

type Mode = "token" | "redstone";

export default function Login() {
  const [mode, setMode] = useState<Mode>("token");
  const [redstoneOn, setRedstoneOn] = useState(false);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Offer "Sign in with Redstone" only when this instance is configured for it.
  useEffect(() => {
    fetch("/auth/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c?.redstone) {
          setRedstoneOn(true);
          setMode("redstone"); // org instance → lead with Redstone
        }
      })
      .catch(() => {});
  }, []);

  const submitToken = async () => {
    const t = token.trim();
    if (!t || busy) return;
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        body: JSON.stringify({ token: t }),
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (r.ok) return void (window.location.href = "/");
      setError(r.status === 401 ? "That token wasn't accepted by the server." : `Sign-in failed (HTTP ${r.status}).`);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitRedstone = async () => {
    const u = username.trim();
    if (!u || !password || busy) return;
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/login/redstone", {
        method: "POST",
        body: JSON.stringify({ username: u, password }),
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (r.ok) return void (window.location.href = "/");
      const j = await r.json().catch(() => ({}));
      setError(j.error_description ?? (r.status === 401 ? "Invalid Redstone username or password." : `Sign-in failed (HTTP ${r.status}).`));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "9px 0",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "center",
    cursor: "pointer",
    borderRadius: 10,
    border: 0,
    background: active ? "rgba(var(--primary), 0.18)" : "transparent",
    color: active ? "var(--text)" : "var(--text-soft, #8a8078)",
  });

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="glass-surface" style={{ width: 440, maxWidth: "94vw", borderRadius: 20, padding: "40px 38px" }}>
        <span className="kicker">Redstone Cowork</span>
        <h1 className="display" style={{ fontSize: 40, margin: "12px 0 6px" }}>Welcome</h1>
        <p className="soft" style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 24px" }}>
          Your control plane for Claude Code sessions. Connect this browser to your cowork server to
          triage decisions, monitor sessions, and pick up where your agents need you.
        </p>

        {redstoneOn && (
          <div style={{ display: "flex", gap: 6, padding: 4, marginBottom: 22, border: "1px solid var(--border, rgba(0,0,0,0.1))", borderRadius: 12 }}>
            <button style={tabStyle(mode === "redstone")} onClick={() => { setMode("redstone"); setError(""); }}>Redstone account</button>
            <button style={tabStyle(mode === "token")} onClick={() => { setMode("token"); setError(""); }}>Instance token</button>
          </div>
        )}

        {mode === "redstone" && redstoneOn ? (
          <>
            <label className="soft" style={{ display: "block", fontSize: 13, marginBottom: 7 }}>Redstone username</label>
            <input
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRedstone()}
              placeholder="you@yourorg"
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={{ marginBottom: 14 }}
            />
            <label className="soft" style={{ display: "block", fontSize: 13, marginBottom: 7 }}>Password</label>
            <input
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRedstone()}
              placeholder="Your Redstone password"
              autoComplete="current-password"
            />
            <p className="faint" style={{ fontSize: 12, lineHeight: 1.5, margin: "8px 2px 24px" }}>
              Sign in with your organization&apos;s Redstone account. Your password is exchanged for a token
              server-side and never stored here.
            </p>
            <button className="glass-btn--clay" onClick={submitRedstone} disabled={busy} style={{ width: "100%", padding: "13px 0", fontSize: 15, fontWeight: 600, border: 0 }}>
              {busy ? "Signing in…" : "Sign in with Redstone"}
            </button>
          </>
        ) : (
          <>
            <label className="soft" style={{ display: "block", fontSize: 13, marginBottom: 7 }}>Instance token</label>
            <input
              className="field mono"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitToken()}
              placeholder="Paste your INSTANCE_TOKEN"
              autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
            />
            <p className="faint" style={{ fontSize: 12, lineHeight: 1.5, margin: "8px 2px 24px" }}>
              Find it in your server&apos;s <span className="mono">.env</span> as{" "}
              <span className="mono">INSTANCE_TOKEN</span>. This browser talks to the same server that hosts this page.
            </p>
            <button className="glass-btn--clay" onClick={submitToken} disabled={busy} style={{ width: "100%", padding: "13px 0", fontSize: 15, fontWeight: 600, border: 0 }}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </>
        )}
        {error && <p className="mono" style={{ color: "#e0736a", fontSize: 12.5, marginTop: 14 }}>{error}</p>}
      </div>
    </main>
  );
}
