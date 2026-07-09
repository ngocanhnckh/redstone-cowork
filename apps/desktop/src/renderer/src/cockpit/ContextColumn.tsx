import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Todo, UserTodo } from "../types";
import Markdown from "./Markdown";
import TodoProgress from "./TodoProgress";

/** A small square checkbox glyph shared by Claude's plan rows and user checklist rows. */
function CheckBox({
  state,
  onClick,
}: {
  state: "done" | "active" | "open";
  onClick?: () => void;
}) {
  const done = state === "done";
  const active = state === "active";
  return (
    <span
      onClick={onClick}
      style={{
        width: 16,
        height: 16,
        borderRadius: 5,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        cursor: onClick ? "pointer" : undefined,
        background: done ? `rgb(var(--accent))` : active ? `rgb(var(--primary) / 0.25)` : "rgb(var(--primary) / 0.06)",
        // Open-state border uses an accent color (not --border-strong, which the
        // transparent-HUD theme blanks — that made the unchecked box invisible).
        border: done ? "none" : active ? `1.5px solid rgb(var(--primary-soft))` : `1.5px solid rgb(var(--primary-soft) / 0.55)`,
        color: done ? "#2a1d09" : undefined,
        fontWeight: done ? 700 : undefined,
        fontSize: done ? 11 : undefined,
      }}
    >
      {done ? "✓" : null}
    </span>
  );
}

/** Claude's own plan item — read-only (reflects Claude's live task state). */
function PlanRow({ todo }: { todo: Todo }) {
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
      <CheckBox state={completed ? "done" : inProgress ? "active" : "open"} />
      <span style={{ textDecoration: completed ? "line-through" : undefined }}>{todo.text}</span>
    </div>
  );
}

/** User checklist item — click the box to toggle, hover to reveal delete. */
function UserRow({
  todo,
  onToggle,
  onDelete,
}: {
  todo: UserTodo;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "8px 9px",
        borderRadius: 9,
        fontSize: 13,
        color: todo.done ? "var(--text-faint)" : "var(--text)",
      }}
    >
      <CheckBox state={todo.done ? "done" : "open"} onClick={onToggle} />
      <span style={{ flex: 1, textDecoration: todo.done ? "line-through" : undefined }}>{todo.text}</span>
      {hover && (
        <button
          onClick={onDelete}
          title="Remove"
          style={{
            border: 0,
            background: "transparent",
            color: "var(--text-faint)",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function ContextColumn({ sessionId, hideSummary }: { sessionId?: string; hideSummary?: boolean } = {}) {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const refresh = useStore((s) => s.refresh);
  const addUserTodo = useStore((s) => s.addUserTodo);
  const toggleUserTodo = useStore((s) => s.toggleUserTodo);
  const deleteUserTodo = useStore((s) => s.deleteUserTodo);
  const [summarizing, setSummarizing] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"tasks" | "claude">("tasks"); // Tasks (yours) ⇄ Claude's plan
  const todosScrollRef = useRef<HTMLDivElement>(null);
  const wantScroll = useRef(false);

  const id = sessionId ?? focusId;
  const session =
    sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);

  // Claude's plan sorted undone-first (in_progress, then pending, then completed).
  const planRank = (t: Todo) => (t.status === "completed" ? 2 : t.status === "in_progress" ? 0 : 1);
  const plan = [...(session?.todos ?? [])].sort((a, b) => planRank(a) - planRank(b));
  const userTodos = session?.userTodos ?? [];
  // Progress items per tab ("done" means different things for each list).
  const userItems = userTodos.map((t) => ({ done: t.done }));
  const planItems = plan.map((t) => ({ done: t.status === "completed" }));
  const userDone = userItems.filter((t) => t.done).length;
  const planDone = planItems.filter((t) => t.done).length;

  function submitTodo() {
    if (!id || !draft.trim()) return;
    wantScroll.current = true; // scroll the list to the new item once it renders
    addUserTodo(id, draft);
    setDraft("");
  }

  // After adding a task, scroll the todo list to the bottom so the new item shows.
  useEffect(() => {
    if (wantScroll.current && todosScrollRef.current) {
      todosScrollRef.current.scrollTop = todosScrollRef.current.scrollHeight;
      wantScroll.current = false;
    }
  }, [userTodos.length]);

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
    if (hideSummary) return; // summary hidden here — don't spend tokens generating one
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
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Summary — fixed height so a long todo list can't squeeze it; scrolls internally. */}
      {!hideSummary && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
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
              height: 168,
              flexShrink: 0,
              overflowY: "auto",
            }}
          >
            {session?.summary ? (
              <Markdown>{session.summary}</Markdown>
            ) : (
              <span className="faint" style={{ fontStyle: "italic" }}>
                No summary yet.
              </span>
            )}
          </div>
        </>
      )}

      {/* Progress ring for the active tab (your tasks, or Claude's plan). */}
      <div style={{ flexShrink: 0 }}>
        <TodoProgress items={tab === "tasks" ? userItems : planItems} label={tab === "tasks" ? "your tasks" : "claude's plan"} />
      </div>

      {/* Tabs: your checklist ⇄ Claude's plan (each carries a done/total badge). */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {([
          { key: "tasks", label: "Tasks", badge: `${userDone}/${userItems.length}` },
          { key: "claude", label: "Claude", badge: `${planDone}/${planItems.length}` },
        ] as const).map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999,
                fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
                border: `1px solid ${on ? "rgb(var(--primary-soft) / 0.5)" : "var(--border)"}`,
                background: on ? "rgb(var(--primary) / 0.22)" : "transparent",
                color: on ? "var(--text)" : "var(--text-soft)",
              }}
            >
              {t.label}
              <span className="mono faint" style={{ fontSize: 9.5, opacity: 0.75 }}>{t.badge}</span>
            </button>
          );
        })}
      </div>

      {/* Active tab's list — scrollable middle region. */}
      <div
        ref={todosScrollRef}
        className="no-scrollbar"
        style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}
      >
        {tab === "claude" ? (
          plan.length > 0 ? (
            plan.map((todo, i) => <PlanRow key={i} todo={todo} />)
          ) : (
            <span className="faint" style={{ fontSize: 12, fontStyle: "italic", padding: "4px 9px" }}>
              Claude hasn't set a plan yet.
            </span>
          )
        ) : userTodos.length > 0 ? (
          userTodos.map((t) => (
            <UserRow
              key={t.id}
              todo={t}
              onToggle={() => id && toggleUserTodo(id, t.id)}
              onDelete={() => id && deleteUserTodo(id, t.id)}
            />
          ))
        ) : (
          <span className="faint" style={{ fontSize: 12, fontStyle: "italic", padding: "4px 9px" }}>
            No tasks yet — add one below.
          </span>
        )}
      </div>

      {/* Add a checklist item — pinned below the scroll region (Tasks tab only;
          Claude's plan is read-only). */}
      {tab === "tasks" && (
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitTodo(); }}
          placeholder="Add a to-do…"
          disabled={!session}
          style={{
            flex: 1,
            minWidth: 0,
            border: "1px solid var(--border)",
            background: "transparent",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12.5,
            color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          onClick={submitTodo}
          disabled={!session || !draft.trim()}
          title="Add to your checklist"
          style={{
            border: "1px solid var(--border)",
            background: draft.trim() ? "rgb(var(--primary) / 0.28)" : "transparent",
            color: draft.trim() ? "#fff" : "var(--text-soft)",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            cursor: session && draft.trim() ? "pointer" : "default",
          }}
        >
          +
        </button>
      </div>
      )}
    </div>
  );
}
