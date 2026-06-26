import { useStore } from "../store";
import type { SessionView } from "../types";

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}
function initials(cwd: string): string {
  const n = projectName(cwd).replace(/[^a-zA-Z0-9]/g, "");
  return (n.slice(0, 2) || "··").toUpperCase();
}
function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// status → { color, label }
const STATUS: Record<string, { color: string; label: string }> = {
  waiting: { color: "rgb(var(--accent))", label: "needs you" },
  active: { color: "#5fd0a0", label: "working" },
  stale: { color: "#b9a06a", label: "idle" },
  lost: { color: "#9a8e7c", label: "lost" },
};

export default function AgentGrid() {
  const sessions = useStore((s) => s.sessions);
  const openDetail = useStore((s) => s.openDetail);

  if (sessions.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div className="display" style={{ fontSize: 30, color: "var(--text-soft)", marginBottom: 12 }}>
            No agents connected
          </div>
          <p className="soft" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            On a machine running Claude Code, install the host, then in your project run{" "}
            <code className="mono" style={{ color: "rgb(var(--primary-soft))" }}>redstone hook</code> and start a
            session with <code className="mono" style={{ color: "rgb(var(--primary-soft))" }}>claude --resume</code>.
            It will appear here live.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px" }} className="no-scrollbar">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {sessions.map((s) => (
          <Tile key={s.id} s={s} onClick={() => openDetail(s.id)} />
        ))}
      </div>
    </div>
  );
}

function Tile({ s, onClick }: { s: SessionView; onClick: () => void }) {
  const st = STATUS[s.status] ?? STATUS.lost;
  const live = s.status === "active" || s.status === "waiting";
  const preview = s.latestAnswer?.split("\n").find((l) => l.trim()) ?? s.summary ?? "";

  return (
    <button
      onClick={onClick}
      className="glass-inset glass-inset-hover"
      style={{
        textAlign: "left",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 14,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 132,
        color: "var(--text)",
        position: "relative",
        boxShadow: s.status === "waiting" ? "inset 0 0 0 1px rgb(var(--accent) / 0.35)" : undefined,
      }}
    >
      {/* header: initials + name + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          className="mono"
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 600,
            background: "rgba(255,255,255,0.05)",
            flexShrink: 0,
          }}
        >
          {initials(s.cwd)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {projectName(s.cwd)}
          </div>
          <div className="mono faint" style={{ fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.machine}
          </div>
        </div>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 99,
            background: st.color,
            flexShrink: 0,
            boxShadow: live ? `0 0 0 0 ${st.color}` : undefined,
            animation: live ? "pulse 2s infinite" : undefined,
          }}
        />
      </div>

      {/* preview line */}
      <div
        className="soft"
        style={{
          fontSize: 12,
          lineHeight: 1.45,
          flex: 1,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {preview || <span className="faint" style={{ fontStyle: "italic" }}>no output yet</span>}
      </div>

      {/* footer: status label + ago */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: st.color,
          }}
        >
          ● {st.label}
        </span>
        <span className="mono faint" style={{ fontSize: 10 }}>
          {s.pendingDecisions > 0 ? `${s.pendingDecisions} pending` : ago(s.lastSeenAt)}
        </span>
      </div>
    </button>
  );
}
