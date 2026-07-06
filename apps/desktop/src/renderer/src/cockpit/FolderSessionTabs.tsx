import { useStore } from "../store";

/**
 * When more than one Claude Code session is running in the SAME folder (same
 * machine + cwd — e.g. two sessions started in one project), this strip lets you
 * switch between them right from the chat, and pop any of them into its own
 * floating HUD window so you can work on two side by side.
 *
 * Renders nothing when the reference session's folder has only one session.
 */
export default function FolderSessionTabs({ sessionId }: { sessionId?: string | null }) {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);
  const setFocus = useStore((s) => s.setFocus);
  const openSessionWindow = useStore((s) => s.openSessionWindow);

  const id = sessionId ?? focusId;
  const all = [...sessions, ...queue];
  const ref = all.find((s) => s.id === id);
  if (!ref) return null;

  // Siblings in the same folder, stable order (attach time) so labels don't jump.
  const siblings = all
    .filter((s) => s.machine === ref.machine && s.cwd === ref.cwd)
    .sort((a, b) => new Date(a.attachedAt ?? 0).getTime() - new Date(b.attachedAt ?? 0).getTime());
  if (siblings.length < 2) return null;

  const waitingIds = new Set(decisions.filter((d) => d.kind === "question" || d.kind === "permission" || d.kind === "mode").map((d) => d.sessionId));

  return (
    <div className="no-scrollbar" style={{ display: "flex", alignItems: "center", gap: 5, overflowX: "auto", padding: "6px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <span className="mono faint" style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", flexShrink: 0, marginRight: 2 }}>same folder</span>
      {siblings.map((s, i) => {
        const on = s.id === focusId;
        const waiting = waitingIds.has(s.id) || s.status === "waiting";
        const dot = waiting ? "rgb(var(--accent))" : s.working ? "rgb(var(--primary-soft))" : "var(--border-strong)";
        const label = s.gitBranch || `#${s.id.slice(0, 4)}`;
        return (
          <span
            key={s.id}
            onClick={() => setFocus(s.id)}
            title={`${label} · ${s.status}${s.working ? " · working" : ""}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, cursor: "pointer",
              padding: "3px 8px", borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: 10.5,
              border: `1px solid ${on ? "rgb(var(--primary-soft) / 0.5)" : "var(--border)"}`,
              background: on ? "rgb(var(--primary) / 0.2)" : "transparent",
              color: on ? "var(--text)" : "var(--text-soft)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: dot, flexShrink: 0 }} className={s.working ? "hud-pulse" : undefined} />
            <span style={{ opacity: 0.6 }}>{i + 1}</span>
            <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            <span
              onClick={(e) => { e.stopPropagation(); openSessionWindow(s.id); }}
              title="Open this session in its own window (side by side)"
              style={{ opacity: 0.5, fontSize: 11, lineHeight: 1, flexShrink: 0 }}
            >⧉</span>
          </span>
        );
      })}
    </div>
  );
}
