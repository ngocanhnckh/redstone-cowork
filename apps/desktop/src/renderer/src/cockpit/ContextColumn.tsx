import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Todo } from "../types";

function TodoRow({ todo }: { todo: Todo }) {
  const completed = todo.status === "completed";
  const inProgress = todo.status === "in_progress";

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "8px 9px",
        borderRadius: 9,
        fontSize: 13,
        background: inProgress ? `rgb(var(--primary) / 0.12)` : undefined,
        color: completed ? "var(--text-faint)" : "var(--text)",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 5,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          background: completed
            ? `rgb(var(--accent))`
            : inProgress
            ? `rgb(var(--primary) / 0.25)`
            : "transparent",
          border: completed
            ? "none"
            : inProgress
            ? `1.5px solid rgb(var(--primary-soft))`
            : `1.5px solid var(--border-strong)`,
          color: completed ? "#2a1d09" : undefined,
          fontWeight: completed ? 700 : undefined,
          fontSize: completed ? 11 : undefined,
        }}
      >
        {completed ? "✓" : null}
      </span>
      <span style={{ textDecoration: completed ? "line-through" : undefined }}>
        {todo.text}
      </span>
    </div>
  );
}

export default function ContextColumn({ sessionId }: { sessionId?: string } = {}) {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const refresh = useStore((s) => s.refresh);
  const [summarizing, setSummarizing] = useState(false);

  const id = sessionId ?? focusId;
  const session =
    sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);

  async function summarize() {
    if (!id || summarizing) return;
    setSummarizing(true);
    try {
      await window.cowork.llmAssist({ sessionId: id, kind: "summarize" });
      await refresh();
    } catch {
      /* surfaced as no-change; the assistant panel shows detailed errors */
    } finally {
      setSummarizing(false);
    }
  }

  // Auto-summarize the first time we view a session that has a real conversation
  // but no summary yet. Once per session per app run; the persisted summary (and
  // this guard) prevent re-spending tokens on every glance.
  const autoTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!id || !session) return;
    if (session.summary) return;
    if ((session.transcript?.length ?? 0) < 2) return;
    if (autoTried.current.has(id)) return;
    autoTried.current.add(id);
    summarize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session?.summary, session?.transcript?.length]);

  return (
    <div
      style={{
        padding: "20px 18px",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="kicker">Summary</div>
        <span style={{ flex: 1 }} />
        <button
          onClick={summarize}
          disabled={summarizing || !session}
          title="Summarize this session with the LLM"
          style={{
            border: "1px solid var(--border)",
            background: summarizing ? "rgb(var(--primary) / 0.2)" : "transparent",
            color: "var(--text-soft)",
            borderRadius: 7,
            padding: "3px 9px",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            cursor: summarizing ? "default" : "pointer",
          }}
        >
          {summarizing ? "…" : session?.summary ? "↻ refresh" : "✦ summarize"}
        </button>
      </div>
      <div
        className="glass-inset no-scrollbar"
        style={{
          padding: "13px 14px",
          borderRadius: 13,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--text-soft)",
          maxHeight: 158,
          overflowY: "auto",
        }}
      >
        {session?.summary ?? (
          <span className="faint" style={{ fontStyle: "italic" }}>
            No summary yet.
          </span>
        )}
      </div>

      <div className="kicker">Session todos</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {session && session.todos.length > 0 ? (
          session.todos.map((todo, i) => <TodoRow key={i} todo={todo} />)
        ) : (
          <span className="faint" style={{ fontSize: 12, fontStyle: "italic", padding: "4px 9px" }}>
            No todos yet.
          </span>
        )}
      </div>
    </div>
  );
}
