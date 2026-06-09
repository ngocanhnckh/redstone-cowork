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
      setError(r.status === 401 ? "Invalid token." : `Sign-in failed (HTTP ${r.status}).`);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 380, margin: "10vh auto" }}>
      <h1>Redstone Cowork</h1>
      <p>Enter your instance token (from the server&apos;s .env):</p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #2a3550", background: "#131a2e", color: "inherit", boxSizing: "border-box", fontSize: 16 }}
      />
      <button
        onClick={submit}
        disabled={busy}
        style={{ marginTop: 12, padding: "12px 24px", borderRadius: 8, border: 0, background: busy ? "#2a3550" : "#3b6ef6", color: "white", width: "100%", cursor: busy ? "not-allowed" : "pointer", fontSize: 16 }}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
    </main>
  );
}
