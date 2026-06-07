"use client";
import { useState } from "react";

export default function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ token }), headers: { "Content-Type": "application/json" } });
    if (r.ok) window.location.href = "/";
    else setError("Invalid token");
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
        style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #2a3550", background: "#131a2e", color: "inherit", boxSizing: "border-box" }}
      />
      <button
        onClick={submit}
        style={{ marginTop: 12, padding: "12px 24px", borderRadius: 8, border: 0, background: "#3b6ef6", color: "white", width: "100%", cursor: "pointer" }}
      >
        Sign in
      </button>
      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
    </main>
  );
}
