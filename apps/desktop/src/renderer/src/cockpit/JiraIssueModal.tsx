import { useEffect, useState } from "react";

type SubIssue = { key: string; summary: string; status: string; statusCategory: string; assignee: string | null; url: string };
type Detail = {
  key: string; summary: string; status: string; statusCategory: string; assignee: string | null; url: string;
  descriptionHtml: string; description: string; issueType: string; subtaskAllowed: boolean;
  subtasks: SubIssue[]; comments: Array<{ author: string | null; created: string; bodyHtml: string }>;
};

const CAT_COLOR: Record<string, string> = {
  todo: "var(--text-faint)", inprogress: "rgb(var(--primary-soft))", done: "#6bbf82",
};

/** Minimal HTML sanitizer for Jira rendered fields — strips scripts/styles, inline
 * event handlers and javascript: URLs. It's the user's own Jira, but never inject
 * live script. Not a full sanitizer; good enough for Jira's rendered output. */
function sanitize(html: string): string {
  return (html || "")
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}

type Transition = { id: string; name: string; to: string };

/** Rich Jira issue detail — summary, status, assignee, rendered description and
 * comments — in a themed modal. Supports editing summary/description in place and
 * adding subtasks (for issue types that allow them). Esc or the backdrop closes it.
 * Clicking a subtask navigates the modal into it (with a back-to-parent link). */
export default function JiraIssueModal({ sessionId, issueKey, onClose, startAddSubtask }: { sessionId: string; issueKey: string; onClose: () => void; startAddSubtask?: boolean }) {
  // The issue currently shown — starts at the opened key, changes as you drill
  // into a subtask (so one modal can browse a parent + its children).
  const [activeKey, setActiveKey] = useState(issueKey);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Edit mode: local drafts of summary + description; null editSummary means "not editing".
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editDesc, setEditDesc] = useState("");
  // Add-subtask composer.
  const [addingSub, setAddingSub] = useState(false);
  const [subText, setSubText] = useState("");

  useEffect(() => {
    let alive = true;
    setState("loading");
    setEditing(false);
    setAddingSub(false);
    const transFn = window.cowork.jiraIssueTransitions;
    Promise.all([
      window.cowork.jiraIssueDetail(sessionId, activeKey),
      typeof transFn === "function" ? transFn(sessionId, activeKey).catch(() => [] as Transition[]) : Promise.resolve([] as Transition[]),
    ])
      .then(([d, t]) => {
        if (!alive) return;
        const det = d as Detail;
        setDetail(det); setTransitions(t as Transition[]); setState("ok");
        // Right-clicked "Add subtask" on the opened issue → open the composer once
        // it's loaded (only if this type actually allows subtasks).
        if (startAddSubtask && activeKey === issueKey && det.subtaskAllowed) setAddingSub(true);
      })
      .catch(() => { if (alive) setState("err"); });
    return () => { alive = false; };
  }, [sessionId, activeKey, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  // Refetch the Tasks tab list/progress too (a status/summary change is visible there).
  const notifyTasks = () => window.dispatchEvent(new CustomEvent("rcw-jira-binding", { detail: { sessionId } }));

  const applyTransition = async (transitionId: string) => {
    if (!transitionId || busy) return;
    setBusy(true);
    try {
      await window.cowork.jiraTransitionIssue(sessionId, activeKey, transitionId);
      notifyTasks();
      reload();
    } catch { /* leave the current status; the dropdown stays put */ }
    finally { setBusy(false); }
  };

  const startEdit = () => {
    if (!detail) return;
    setEditSummary(detail.summary);
    setEditDesc(detail.description ?? "");
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!detail || busy) return;
    const fields: { summary?: string; description?: string } = {};
    if (editSummary.trim() && editSummary !== detail.summary) fields.summary = editSummary.trim();
    if (editDesc !== (detail.description ?? "")) fields.description = editDesc;
    if (Object.keys(fields).length === 0) { setEditing(false); return; }
    setBusy(true);
    try {
      await window.cowork.jiraUpdateIssue(sessionId, activeKey, fields);
      setEditing(false);
      notifyTasks();
      reload();
    } catch { /* keep the draft open so edits aren't lost */ }
    finally { setBusy(false); }
  };

  const addSubtask = async () => {
    const summary = subText.trim();
    if (!summary || busy) return;
    setBusy(true);
    try {
      await window.cowork.jiraCreateSubtask(sessionId, activeKey, summary);
      setSubText("");
      setAddingSub(false);
      notifyTasks();
      reload();
    } catch { /* leave the composer open */ }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const iconBtn: React.CSSProperties = { border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 7, padding: "3px 9px", fontSize: 12, cursor: "pointer", flexShrink: 0 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} className="glass-surface" style={{
        width: 640, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column",
        borderRadius: 16, border: "1px solid var(--border-strong)", boxShadow: "0 24px 70px rgba(0,0,0,0.6)", overflow: "hidden",
        background: "color-mix(in srgb, var(--app-panel, #1b1712) 94%, transparent)",
        backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)",
      }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: CAT_COLOR[detail?.statusCategory ?? "todo"] ?? "var(--text-faint)", flexShrink: 0 }} />
          <a href={detail?.url || "#"} onClick={(e) => { e.preventDefault(); if (detail?.url) window.cowork.openExternal(detail.url).catch(() => {}); }}
            className="mono" style={{ fontSize: 12, color: "rgb(var(--primary-soft))", textDecoration: "none", flexShrink: 0, cursor: "pointer" }} title="Open in Jira">{activeKey} ↗</a>
          {detail?.issueType && <span className="mono faint" style={{ fontSize: 10, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 5, padding: "1px 5px" }}>{detail.issueType}</span>}
          {!editing && <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail?.summary}</span>}
          {editing && <span style={{ flex: 1 }} />}
          {detail && detail.assignee && !editing && <span className="mono faint" style={{ fontSize: 10.5, flexShrink: 0 }}>{detail.assignee}</span>}
          {detail && !editing && (
            <button onClick={startEdit} title="Edit summary & description" style={iconBtn}>✎</button>
          )}
          {detail && !editing && (
            <select
              value=""
              disabled={busy || transitions.length === 0}
              onChange={(e) => applyTransition(e.target.value)}
              title={transitions.length ? "Change status" : "No transitions available"}
              className="mono"
              style={{
                flexShrink: 0, maxWidth: 150, border: "1px solid var(--border-strong)",
                background: `color-mix(in srgb, ${CAT_COLOR[detail.statusCategory] ?? "var(--text-faint)"} 22%, transparent)`,
                color: "var(--text)", borderRadius: 8, padding: "4px 8px", fontSize: 11,
                outline: "none", cursor: busy ? "wait" : "pointer",
              }}
            >
              <option value="">{busy ? "updating…" : detail.status || "status"}</option>
              {transitions.map((t) => (
                <option key={t.id} value={t.id}>→ {t.to || t.name}</option>
              ))}
            </select>
          )}
          {editing && (
            <>
              <button onClick={saveEdit} disabled={busy} className="glass-btn--clay" style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, flexShrink: 0, opacity: busy ? 0.6 : 1 }}>{busy ? "saving…" : "Save"}</button>
              <button onClick={() => setEditing(false)} disabled={busy} style={iconBtn}>Cancel</button>
            </>
          )}
          <button onClick={onClose} style={iconBtn}>✕</button>
        </div>
        {/* body */}
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px" }}>
          {/* When drilled into a subtask, a link back to the originally-opened issue. */}
          {activeKey !== issueKey && (
            <button onClick={() => setActiveKey(issueKey)} className="mono" style={{ ...iconBtn, marginBottom: 12 }}>← back to {issueKey}</button>
          )}
          {state === "loading" ? (
            <div className="faint mono hud-blink" style={{ fontSize: 12 }}>loading issue…</div>
          ) : state === "err" ? (
            <div style={{ fontSize: 12.5, color: "#e0736a" }}>Could not load this issue from Jira.</div>
          ) : detail ? (
            <>
              {editing ? (
                <>
                  <input
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    placeholder="Summary"
                    className="reply-input"
                    style={{ width: "100%", padding: "8px 11px", fontSize: 14, marginBottom: 10, background: "rgba(0,0,0,0.22)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--text)", outline: "none" }}
                  />
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Description (Jira wiki markup)…"
                    rows={10}
                    className="mono"
                    style={{ width: "100%", padding: "10px 12px", fontSize: 12.5, lineHeight: 1.55, background: "rgba(0,0,0,0.22)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--text)", outline: "none", resize: "vertical" }}
                  />
                </>
              ) : detail.descriptionHtml ? (
                <div className="jira-rich" style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-soft)" }} dangerouslySetInnerHTML={{ __html: sanitize(detail.descriptionHtml) }} />
              ) : (
                <div className="faint" style={{ fontSize: 12.5, fontStyle: "italic" }}>No description.</div>
              )}

              {/* Subtasks — list existing (clickable) and, for allowed types, add more. */}
              {!editing && (detail.subtasks.length > 0 || detail.subtaskAllowed) && (
                <>
                  <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", margin: "18px 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Subtasks · {detail.subtasks.length}</span>
                    <span style={{ flex: 1 }} />
                    {detail.subtaskAllowed && !addingSub && (
                      <button onClick={() => setAddingSub(true)} style={{ ...iconBtn, fontSize: 10, padding: "2px 8px" }}>+ add</button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {detail.subtasks.map((s) => (
                      <div
                        key={s.key}
                        onClick={() => setActiveKey(s.key)}
                        title={`${s.status} — open subtask`}
                        className="glass-inset-hover"
                        style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 9, fontSize: 12.5, cursor: "pointer", color: s.statusCategory === "done" ? "var(--text-faint)" : "var(--text)" }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: CAT_COLOR[s.statusCategory] ?? "var(--border-strong)", flexShrink: 0 }} />
                        <span className="mono faint" style={{ fontSize: 10, flexShrink: 0 }}>{s.key}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: s.statusCategory === "done" ? "line-through" : undefined }}>{s.summary}</span>
                      </div>
                    ))}
                    {addingSub && (
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <input
                          autoFocus
                          value={subText}
                          onChange={(e) => setSubText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addSubtask(); else if (e.key === "Escape") { setAddingSub(false); setSubText(""); } }}
                          placeholder="Subtask summary…"
                          className="reply-input"
                          style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, background: "rgba(0,0,0,0.22)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--text)", outline: "none" }}
                        />
                        <button onClick={addSubtask} disabled={busy || !subText.trim()} className="glass-btn--clay" style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, flexShrink: 0, opacity: busy || !subText.trim() ? 0.6 : 1 }}>Add</button>
                        <button onClick={() => { setAddingSub(false); setSubText(""); }} style={iconBtn}>✕</button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {detail.comments.length > 0 && !editing && (
                <>
                  <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", margin: "18px 0 8px" }}>Comments · {detail.comments.length}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {detail.comments.map((c, i) => (
                      <div key={i} className="glass-inset" style={{ padding: "10px 12px", borderRadius: 11 }}>
                        <div className="mono" style={{ fontSize: 10.5, color: "rgb(var(--primary-soft))", marginBottom: 5 }}>{c.author ?? "unknown"} <span className="faint" style={{ marginLeft: 6 }}>{c.created?.slice(0, 10)}</span></div>
                        <div className="jira-rich" style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-soft)" }} dangerouslySetInnerHTML={{ __html: sanitize(c.bodyHtml) }} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
