"use client";
import { useState } from "react";

export default function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
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
      if (r.ok) {
        window.location.href = "/";
        return;
      }
      setError(r.status === 401 ? "That token wasn't accepted by the server." : `Sign-in failed (HTTP ${r.status}).`);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="glass-surface" style={{ width: 440, maxWidth: "94vw", borderRadius: 20, padding: "40px 38px" }}>
        <span className="kicker">Redstone Cowork</span>
        <h1 className="display" style={{ fontSize: 40, margin: "12px 0 6px" }}>Welcome</h1>
        <p className="soft" style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 28px" }}>
          Your control plane for Claude Code sessions. Connect this browser to your cowork server to
          triage decisions, monitor sessions, and pick up where your agents need you.
        </p>

        <label className="soft" style={{ display: "block", fontSize: 13, marginBottom: 7 }}>Instance token</label>
        <input
          className="field mono"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Paste your INSTANCE_TOKEN"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.5, margin: "8px 2px 24px" }}>
          Find it in your server&apos;s <span className="mono">.env</span> as{" "}
          <span className="mono">INSTANCE_TOKEN</span>. This browser talks to the same server that hosts this page.
        </p>

        <button className="glass-btn--clay" onClick={submit} disabled={busy} style={{ width: "100%", padding: "13px 0", fontSize: 15, fontWeight: 600, border: 0 }}>
          {busy ? "Connecting…" : "Connect"}
        </button>
        {error && <p className="mono" style={{ color: "#e0736a", fontSize: 12.5, marginTop: 14 }}>{error}</p>}
      </div>
    </main>
  );
}
