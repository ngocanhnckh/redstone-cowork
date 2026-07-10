import { useEffect, useState } from "react";

type Detail = {
  key: string; summary: string; status: string; statusCategory: string; assignee: string | null; url: string;
  descriptionHtml: string; comments: Array<{ author: string | null; created: string; bodyHtml: string }>;
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

/** Rich Jira issue detail — summary, status, assignee, rendered description and
 * comments — in a themed modal overlay. Esc or the backdrop closes it. */
type Transition = { id: string; name: string; to: string };

export default function JiraIssueModal({ sessionId, issueKey, onClose }: { sessionId: string; issueKey: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  // Workflow transitions available for this issue (project-specific, incl. custom
  // statuses) + a busy flag while a status change is applied.
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    Promise.all([
      window.cowork.jiraIssueDetail(sessionId, issueKey),
      window.cowork.jiraIssueTransitions(sessionId, issueKey).catch(() => [] as Transition[]),
    ])
      .then(([d, t]) => { if (alive) { setDetail(d as Detail); setTransitions(t as Transition[]); setState("ok"); } })
      .catch(() => { if (alive) setState("err"); });
    return () => { alive = false; };
  }, [sessionId, issueKey, reloadKey]);

  // Apply a status transition, then reload the issue (new status + fresh transitions)
  // and nudge the Tasks tab to refetch so its list/progress ring reflect the change.
  const applyTransition = async (transitionId: string) => {
    if (!transitionId || busy) return;
    setBusy(true);
    try {
      await window.cowork.jiraTransitionIssue(sessionId, issueKey, transitionId);
      window.dispatchEvent(new CustomEvent("rcw-jira-binding", { detail: { sessionId } }));
      setReloadKey((k) => k + 1);
    } catch { /* leave the current status; the dropdown stays put */ }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} className="glass-surface" style={{
        width: 640, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column",
        borderRadius: 16, border: "1px solid var(--border-strong)", boxShadow: "0 24px 70px rgba(0,0,0,0.6)", overflow: "hidden",
        // Strong opaque background so the modal is readable in the transparent HUD
        // theme (where .glass-surface frosts to near-nothing → a blank-looking screen).
        background: "color-mix(in srgb, var(--app-panel, #1b1712) 94%, transparent)",
        backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)",
      }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: CAT_COLOR[detail?.statusCategory ?? "todo"] ?? "var(--text-faint)", flexShrink: 0 }} />
          <a href={detail?.url || "#"} onClick={(e) => { e.preventDefault(); if (detail?.url) window.cowork.openExternal(detail.url).catch(() => {}); }}
            className="mono" style={{ fontSize: 12, color: "rgb(var(--primary-soft))", textDecoration: "none", flexShrink: 0, cursor: "pointer" }} title="Open in Jira">{issueKey} ↗</a>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail?.summary}</span>
          {detail && detail.assignee && <span className="mono faint" style={{ fontSize: 10.5, flexShrink: 0 }}>{detail.assignee}</span>}
          {detail && (
            // Status control: current status is the placeholder; options are the
            // workflow transitions Jira allows from here (so custom statuses just work).
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
          <button onClick={onClose} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 7, padding: "3px 10px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>
        {/* body */}
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px" }}>
          {state === "loading" ? (
            <div className="faint mono hud-blink" style={{ fontSize: 12 }}>loading issue…</div>
          ) : state === "err" ? (
            <div style={{ fontSize: 12.5, color: "#e0736a" }}>Could not load this issue from Jira.</div>
          ) : detail ? (
            <>
              {detail.descriptionHtml ? (
                <div className="jira-rich" style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-soft)" }} dangerouslySetInnerHTML={{ __html: sanitize(detail.descriptionHtml) }} />
              ) : (
                <div className="faint" style={{ fontSize: 12.5, fontStyle: "italic" }}>No description.</div>
              )}
              {detail.comments.length > 0 && (
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
