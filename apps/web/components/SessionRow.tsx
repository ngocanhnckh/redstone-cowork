"use client";
import { useState } from "react";

const COLORS: Record<string, string> = {
  active: "#3ddc84",
  waiting: "#f6c945",
  stale: "#8a93a6",
  lost: "#ff6b6b",
};

type ModeOption = { id: string; label: string };

const BASE_MODES: ModeOption[] = [
  { id: "default", label: "Normal" },
  { id: "acceptEdits", label: "Auto-edit" },
  { id: "plan", label: "Plan" },
];

const AUTO_MODE: ModeOption = { id: "auto", label: "Auto" };

type Session = {
  id: string;
  machine: string;
  cwd: string;
  status: string;
  pendingDecisions: number;
  wrapperId?: string | null;
  permissionMode?: string | null;
  autoModeEnabled?: boolean;
};

export function SessionRow({ s }: { s: Session }) {
  const [cmd, setCmd] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // optimistic mode state: null means "follow server value"
  const [optimisticMode, setOptimisticMode] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const activeMode = optimisticMode ?? s.permissionMode ?? "default";

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

  const switchMode = async (modeId: string) => {
    if (switching || modeId === activeMode) return;
    const prevMode = optimisticMode ?? s.permissionMode ?? "default";
    setOptimisticMode(modeId);
    setSwitching(true);
    try {
      const res = await fetch(`/api/proxy/sessions/${s.id}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: modeId }),
      });
      if (!res.ok) {
        // revert on error
        setOptimisticMode(prevMode);
      }
      // on 200: keep optimistic; SSE session.updated will reconcile via parent refresh
    } catch {
      setOptimisticMode(prevMode);
    } finally {
      setSwitching(false);
    }
  };

  const modes = s.autoModeEnabled ? [...BASE_MODES, AUTO_MODE] : BASE_MODES;

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
        <>
          {/* Mode switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, opacity: 0.5, marginRight: 2 }}>mode:</span>
            {modes.map((m) => {
              const isActive = m.id === activeMode;
              return (
                <button
                  key={m.id}
                  disabled={switching}
                  onClick={() => switchMode(m.id)}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: "1px solid #2a3550",
                    background: isActive ? "#3b82f6" : "#0e1424",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
                    fontWeight: isActive ? 600 : 400,
                    cursor: switching ? "not-allowed" : isActive ? "default" : "pointer",
                    fontSize: 11,
                    transition: "background 0.15s, color 0.15s",
                    opacity: switching && !isActive ? 0.5 : 1,
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {/* Command box */}
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
        </>
      )}
    </div>
  );
}
