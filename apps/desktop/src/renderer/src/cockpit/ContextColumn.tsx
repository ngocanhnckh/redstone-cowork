import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Todo, UserTodo } from "../types";
import Markdown from "./Markdown";
import TodoProgress from "./TodoProgress";
import JiraIssueModal from "./JiraIssueModal";
import JiraStatusSelect from "./JiraStatusSelect";

type JiraIssue = { key: string; summary: string; status: string; statusCategory: "todo" | "inprogress" | "done"; assignee: string | null; url: string };
const CAT_DOT: Record<string, string> = { todo: "var(--border-strong)", inprogress: "rgb(var(--primary-soft))", done: "#6bbf82" };

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
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [jiraProject, setJiraProject] = useState<string | null>(null);
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  // When the issue modal is opened via right-click "Add subtask", start it in the
  // subtask composer (only takes effect if the issue type allows subtasks).
  const [openWithAddSub, setOpenWithAddSub] = useState(false);
  const todosScrollRef = useRef<HTMLDivElement>(null);
  const wantScroll = useRef(false);

  const id = sessionId ?? focusId;
  const session =
    sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);

  // Load this session's Jira binding + current-sprint issues (if connected). Polls
  // and refetches when the binding changes (Settings dispatches `rcw-jira-binding`).
  useEffect(() => {
    if (!id) { setJiraIssues([]); setJiraProject(null); return; }
    let alive = true;
    const load = async () => {
      try {
        const binding = await window.cowork.jiraGetBinding(id);
        if (!alive) return;
        if (!binding) { setJiraProject(null); setJiraIssues([]); return; }
        setJiraProject(binding.projectKey);
        const issues = await window.cowork.jiraSessionIssues(id);
        if (alive) setJiraIssues(issues as JiraIssue[]);
      } catch { if (alive) { setJiraProject(null); setJiraIssues([]); } }
    };
    load();
    const t = setInterval(load, 30_000);
    const onBind = (e: Event) => { if ((e as CustomEvent<{ sessionId: string }>).detail?.sessionId === id) load(); };
    window.addEventListener("rcw-jira-binding", onBind);
    return () => { alive = false; clearInterval(t); window.removeEventListener("rcw-jira-binding", onBind); };
  }, [id]);

  // Claude's plan sorted undone-first (in_progress, then pending, then completed).
  const planRank = (t: Todo) => (t.status === "completed" ? 2 : t.status === "in_progress" ? 0 : 1);
  const plan = [...(session?.todos ?? [])].sort((a, b) => planRank(a) - planRank(b));
  const userTodos = session?.userTodos ?? [];
  // Progress items per tab. Tasks = your todos + connected Jira sprint issues
  // (a Jira issue is "done" when its status category is done).
  const jiraItems = jiraIssues.map((i) => ({ done: i.statusCategory === "done" }));
  const taskItems = [...userTodos.map((t) => ({ done: t.done })), ...jiraItems];
  const planItems = plan.map((t) => ({ done: t.status === "completed" }));
  const taskDone = taskItems.filter((t) => t.done).length;
  const planDone = planItems.filter((t) => t.done).length;

  function submitTodo() {
    if (!id || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    if (jiraProject) {
      // Jira-connected session → create a Jira issue (assigned to you) instead of a
      // local todo. Optimistically show it; the poll reconciles (a backlog issue
      // that isn't in the sprint will drop off, but it's created in Jira regardless).
      window.cowork.jiraCreateIssue(id, text)
        .then((iss) => setJiraIssues((cur) => (cur.some((c) => c.key === iss.key) ? cur : [...cur, iss])))
        .catch(() => {});
      return;
    }
    wantScroll.current = true; // scroll the list to the new item once it renders
    addUserTodo(id, text);
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
        <TodoProgress items={tab === "tasks" ? taskItems : planItems} label={tab === "tasks" ? (jiraProject ? `tasks + ${jiraProject}` : "your tasks") : "claude's plan"} />
      </div>

      {/* Tabs: your checklist ⇄ Claude's plan (each carries a done/total badge). */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {([
          { key: "tasks", label: "Tasks", badge: `${taskDone}/${taskItems.length}` },
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
        ) : (
          <>
            {userTodos.map((t) => (
              <UserRow
                key={t.id}
                todo={t}
                onToggle={() => id && toggleUserTodo(id, t.id)}
                onDelete={() => id && deleteUserTodo(id, t.id)}
              />
            ))}

            {/* Jira sprint issues for a connected session — a dedicated group. */}
            {jiraProject && (
              <div style={{ marginTop: userTodos.length ? 8 : 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div className="faint" style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "0 9px 2px", opacity: 0.6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>◆ {jiraProject} · current sprint</span>
                  <span style={{ flex: 1 }} />
                  <span>{jiraIssues.filter((i) => i.statusCategory === "done").length}/{jiraIssues.length}</span>
                </div>
                {jiraIssues.length > 0 ? (
                  jiraIssues.map((iss) => (
                    <div
                      key={iss.key}
                      onClick={() => { setOpenWithAddSub(false); setOpenIssue(iss.key); }}
                      onContextMenu={(e) => { e.preventDefault(); setOpenWithAddSub(true); setOpenIssue(iss.key); }}
                      title={`${iss.key}  ${iss.summary}\n${iss.status}${iss.assignee ? " · " + iss.assignee : ""} — click for details · right-click to add a subtask`}
                      style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 9px", borderRadius: 9, fontSize: 13, cursor: "pointer", color: iss.statusCategory === "done" ? "var(--text-faint)" : "var(--text)" }}
                      className="glass-inset-hover"
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: CAT_DOT[iss.statusCategory] ?? "var(--border-strong)", flexShrink: 0 }} />
                      <span className="mono faint" style={{ fontSize: 10, flexShrink: 0 }}>{iss.key}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: iss.statusCategory === "done" ? "line-through" : undefined }}>{iss.summary}</span>
                      {id && (
                        <JiraStatusSelect
                          sessionId={id}
                          issueKey={iss.key}
                          status={iss.status}
                          tint={CAT_DOT[iss.statusCategory]}
                          onChanged={() => window.dispatchEvent(new CustomEvent("rcw-jira-binding", { detail: { sessionId: id } }))}
                        />
                      )}
                    </div>
                  ))
                ) : (
                  <span className="faint" style={{ fontSize: 11.5, fontStyle: "italic", padding: "2px 9px" }}>No sprint issues assigned to you.</span>
                )}
              </div>
            )}

            {userTodos.length === 0 && !jiraProject && (
              <span className="faint" style={{ fontSize: 12, fontStyle: "italic", padding: "4px 9px" }}>
                No tasks yet — add one below.
              </span>
            )}
          </>
        )}
      </div>

      {openIssue && id && <JiraIssueModal sessionId={id} issueKey={openIssue} startAddSubtask={openWithAddSub} onClose={() => { setOpenIssue(null); setOpenWithAddSub(false); }} />}

      {/* Add a checklist item — pinned below the scroll region (Tasks tab only;
          Claude's plan is read-only). */}
      {tab === "tasks" && (
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitTodo(); }}
          placeholder={jiraProject ? `New ${jiraProject} issue (assigned to you)…` : "Add a to-do…"}
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
