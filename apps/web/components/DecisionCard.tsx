"use client";
import { useState } from "react";

type Option = { label: string; description?: string };
export type Decision = {
  id: string;
  sessionId: string;
  kind: string;
  title: string;
  options: Option[];
  createdAt: string;
  body?: Record<string, unknown>;
};

export function DecisionCard({ decision, onResolved }: { decision: Decision; onResolved: (id: string) => void }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const deliverable = decision.body?.deliverable !== false;

  const resolve = async (choice: string | null) => {
    setBusy(true);
    const r = await fetch(`/api/proxy/decisions/${decision.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice, answers: null, custom: custom || null }),
    });
    if (r.ok || r.status === 409) onResolved(decision.id);
    setBusy(false);
  };

  const card: React.CSSProperties = {
    background: "#131a2e",
    border: "1px solid #233052",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  };

  return (
    <div style={card}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>
        {decision.kind} · session {decision.sessionId.slice(0, 8)} · {new Date(decision.createdAt).toLocaleTimeString()}
      </div>
      <div style={{ margin: "8px 0", fontWeight: 600 }}>{decision.title}</div>
      {decision.kind === "permission" || decision.kind === "question" ? (
        <>
          {!deliverable && (
            <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 8px", fontStyle: "italic" }}>
              attach via redstone-claude to answer remotely
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {decision.options.map((o) => (
              <button
                key={o.label}
                disabled={busy || !deliverable}
                onClick={() => resolve(o.label)}
                title={o.description}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: 0,
                  background: !deliverable ? "#2a3550" : o.label === "Deny" ? "#5a2330" : "#3b6ef6",
                  color: "white",
                  opacity: !deliverable ? 0.5 : 1,
                  cursor: !deliverable ? "not-allowed" : "pointer",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          {deliverable && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                placeholder="Custom reply…"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #2a3550", background: "#0e1424", color: "inherit" }}
              />
              <button
                disabled={busy || !custom}
                onClick={() => resolve(null)}
                style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#2a3550", color: "white", cursor: busy || !custom ? "not-allowed" : "pointer" }}
              >
                Send
              </button>
            </div>
          )}
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => resolve("Acknowledged")}
          style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#2a3550", color: "white", cursor: busy ? "not-allowed" : "pointer" }}
        >
          Acknowledge
        </button>
      )}
    </div>
  );
}
