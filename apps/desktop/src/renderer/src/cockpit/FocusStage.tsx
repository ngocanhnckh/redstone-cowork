import { useStore } from "../store";
import AnswerDock from "./AnswerDock";

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export default function FocusStage({ sessionId }: { sessionId?: string } = {}) {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);

  const id = sessionId ?? focusId;
  const session =
    sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);
  const decision = decisions.find((d) => d.sessionId === id);

  if (!session) return null;

  const isWaiting =
    session.status === "waiting" || decision?.kind === "permission";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: 1,
      }}
    >
      {/* Stage head */}
      <div
        style={{
          padding: "24px 32px 20px",
          borderBottom: "1px solid var(--border)",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "5px 11px",
              borderRadius: 999,
              background: isWaiting
                ? `rgb(var(--accent) / 0.16)`
                : `rgba(255,255,255,0.06)`,
              color: isWaiting ? `rgb(var(--accent))` : "var(--text-soft)",
              border: isWaiting
                ? `1px solid rgb(var(--accent) / 0.32)`
                : `1px solid var(--border)`,
            }}
          >
            {isWaiting ? "● needs review" : `● ${session.status}`}
          </span>
        </div>

        <h2
          className="display"
          style={{ fontSize: 38, fontWeight: 400, margin: "0 0 14px", lineHeight: 1 }}
        >
          {projectName(session.cwd)}
        </h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span
            className="glass-inset mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--text-soft)",
              padding: "6px 12px",
              borderRadius: 999,
            }}
          >
            <span className="faint" style={{ fontSize: 8.5, letterSpacing: "0.18em", textTransform: "uppercase" }}>host</span>
            {session.machine}
          </span>
          <span
            className="glass-inset mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--text-soft)",
              padding: "6px 12px",
              borderRadius: 999,
            }}
          >
            <span className="faint" style={{ fontSize: 8.5, letterSpacing: "0.18em", textTransform: "uppercase" }}>branch</span>
            {session.gitBranch ?? "no branch"}
          </span>
          <span
            className="glass-inset mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--text-soft)",
              padding: "6px 12px",
              borderRadius: 999,
            }}
          >
            <span className="faint" style={{ fontSize: 8.5, letterSpacing: "0.18em", textTransform: "uppercase" }}>session</span>
            {session.id.slice(0, 4)}
          </span>
        </div>
      </div>

      {/* Body — latest answer */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "18px 32px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {session.latestAnswer ? (
          <div
            className="glass-inset"
            style={{
              padding: "13px 16px",
              borderRadius: 13,
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              color: "var(--text)",
            }}
          >
            {session.latestAnswer}
          </div>
        ) : (
          <span className="faint" style={{ fontSize: 14, fontStyle: "italic" }}>
            Waiting for output…
          </span>
        )}
      </div>

      {/* Answer dock pinned at bottom */}
      <AnswerDock decision={decision} />
    </div>
  );
}
