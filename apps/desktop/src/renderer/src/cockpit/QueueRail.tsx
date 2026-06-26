import { useStore } from "../store";

function initials(cwd: string): string {
  const base = cwd.split("/").filter(Boolean).pop() ?? "??";
  const words = base.split(/[-_]/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function waitingAgo(since: string | null): string {
  if (!since) return "";
  const diff = Math.max(0, Date.now() - new Date(since).getTime());
  const totalSecs = Math.floor(diff / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins > 0) return `waiting ${mins}m ${secs}s ago`;
  return `waiting ${secs}s ago`;
}

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export default function QueueRail() {
  const queue = useStore((s) => s.queue);
  const sessions = useStore((s) => s.sessions);
  const focusId = useStore((s) => s.focusId);
  const setFocus = useStore((s) => s.setFocus);

  const active = sessions.filter((s) => s.status === "active");

  return (
    <div
      style={{
        padding: "18px 14px",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span className="kicker">Queue</span>
        <span className="mono faint" style={{ fontSize: 11 }}>
          {queue.length} waiting
        </span>
      </div>

      {queue.map((session) => {
        const focused = session.id === focusId;
        return (
          <div
            key={session.id}
            className={focused ? "glass-inset" : "glass-inset glass-inset-hover"}
            onClick={() => setFocus(session.id)}
            style={{
              display: "flex",
              gap: 11,
              alignItems: "center",
              padding: "11px 12px",
              borderRadius: 13,
              cursor: "pointer",
              position: "relative",
              width: "100%",
              background: focused ? `rgba(var(--primary), 0.12)` : undefined,
              borderLeft: focused ? `3px solid rgb(var(--primary-soft))` : undefined,
            }}
          >
            {focused && (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: 14,
                  bottom: 14,
                  width: 3,
                  borderRadius: 9,
                  background: `linear-gradient(rgb(var(--primary-soft)), rgb(var(--accent)))`,
                }}
              />
            )}
            {focused && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: `rgb(var(--accent))`,
                  animation: "pulse 2s infinite",
                  flexShrink: 0,
                }}
              />
            )}
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                display: "grid",
                placeItems: "center",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                fontSize: 12,
                flexShrink: 0,
                background: focused
                  ? `rgb(var(--primary) / 0.3)`
                  : `rgb(var(--accent) / 0.22)`,
                color: focused ? undefined : `rgb(var(--accent))`,
              }}
            >
              {initials(session.cwd)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                {projectName(session.cwd)}
              </div>
              <div className="mono faint" style={{ fontSize: 11 }}>
                {waitingAgo(session.waitingSince)}
              </div>
            </div>
          </div>
        );
      })}

      {active.length > 0 && (
        <>
          <div
            className="faint"
            style={{
              margin: "14px 4px 6px",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.26em",
              textTransform: "uppercase",
            }}
          >
            {active.length} working
          </div>
          {active.map((session) => (
            <div
              key={session.id}
              style={{
                display: "flex",
                gap: 9,
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: 11,
                color: "var(--text-soft)",
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  background: "var(--hover)",
                  flexShrink: 0,
                }}
              >
                {initials(session.cwd)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>{projectName(session.cwd)}</div>
                <div
                  style={{
                    height: 3,
                    borderRadius: 9,
                    background: "var(--hover)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: "50%",
                      background: `linear-gradient(90deg, rgb(var(--primary)), rgb(var(--accent)))`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
