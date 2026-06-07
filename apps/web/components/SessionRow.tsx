"use client";
import { useState } from "react";

const COLORS: Record<string, string> = {
  active: "#3ddc84",
  waiting: "#f6c945",
  stale: "#8a93a6",
  lost: "#ff6b6b",
};

type Session = {
  id: string;
  machine: string;
  cwd: string;
  status: string;
  pendingDecisions: number;
  wrapperId?: string | null;
};

export function SessionRow({ s }: { s: Session }) {
  const [cmd, setCmd] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const sendCommand = async () => {
    if (!cmd.trim()) return;
    setSending(true);
    setSent(false);
    await fetch(`/api/proxy/sessions/${s.id}/instruct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: cmd }),
    });
    setSending(false);
    setSent(true);
    setCmd("");
    setTimeout(() => setSent(false), 3000);
  };

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #1b2440" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: COLORS[s.status] ?? "#888", flexShrink: 0 }} />
        <code style={{ opacity: 0.8 }}>{s.id.slice(0, 8)}</code>
        <span>{s.machine}</span>
        <span style={{ opacity: 0.6, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.cwd}</span>
        <span style={{ whiteSpace: "nowrap" }}>
          {s.status}{s.pendingDecisions > 0 ? ` · ${s.pendingDecisions} pending` : ""}
        </span>
      </div>
      {s.wrapperId && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Send command…"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCommand()}
            style={{
              flex: 1,
              minWidth: 200,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #2a3550",
              background: "#0e1424",
              color: "inherit",
              fontSize: 13,
            }}
          />
          <button
            disabled={sending || !cmd.trim()}
            onClick={sendCommand}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: 0,
              background: sent ? "#3ddc84" : "#2a3550",
              color: "white",
              cursor: sending || !cmd.trim() ? "not-allowed" : "pointer",
              fontSize: 13,
              transition: "background 0.2s",
            }}
          >
            {sent ? "Sent" : sending ? "…" : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
