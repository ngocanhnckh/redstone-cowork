import { useEffect, useState } from "react";

type Transition = { id: string; name: string; to: string };

/**
 * A compact inline status control for a Jira issue — so the user can change status
 * straight from the Tasks list without opening the detail modal. Workflow transitions
 * are lazy-loaded on first interaction (avoids one API call per row up front), so the
 * options reflect exactly what Jira allows from here, including custom statuses.
 */
export default function JiraStatusSelect({
  sessionId, issueKey, status, tint, onChanged,
}: {
  sessionId: string;
  issueKey: string;
  status: string;
  tint?: string;
  onChanged?: () => void;
}) {
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [busy, setBusy] = useState(false);

  // Load eagerly on mount — a native <select> opens with whatever options exist at
  // click time, so lazy-loading would show an empty dropdown on the first click.
  useEffect(() => {
    let alive = true;
    // Guard against a stale preload (old app instance without this IPC) so the
    // component degrades to "current status only" instead of throwing.
    const fn = window.cowork.jiraIssueTransitions;
    if (typeof fn === "function") {
      fn(sessionId, issueKey).then((t) => { if (alive) setTransitions(t); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [sessionId, issueKey]);

  const apply = async (transitionId: string) => {
    if (!transitionId || busy) return;
    setBusy(true);
    try {
      await window.cowork.jiraTransitionIssue(sessionId, issueKey, transitionId);
      onChanged?.();
    } catch { /* leave status as-is on failure */ }
    finally { setBusy(false); }
  };

  return (
    <select
      value=""
      disabled={busy}
      title="Change status"
      // Stop the click bubbling so the row's open-detail handler doesn't also fire.
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => apply(e.target.value)}
      className="mono"
      style={{
        flexShrink: 0, maxWidth: 118, border: "1px solid var(--border)",
        background: tint ? `color-mix(in srgb, ${tint} 24%, transparent)` : "rgba(255,255,255,0.04)",
        color: "var(--text)", borderRadius: 7, padding: "2px 5px", fontSize: 9.5,
        outline: "none", cursor: busy ? "wait" : "pointer",
      }}
    >
      <option value="">{busy ? "…" : status || "status"}</option>
      {transitions.map((t) => (
        <option key={t.id} value={t.id}>→ {t.to || t.name}</option>
      ))}
    </select>
  );
}
