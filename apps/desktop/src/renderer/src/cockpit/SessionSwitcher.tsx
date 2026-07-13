import { useEffect, useRef } from "react";
import { useStore } from "../store";
import type { SessionView } from "../types";

const projectName = (cwd: string): string => cwd.split("/").filter(Boolean).pop() ?? cwd;

type Status = { label: string; color: string };
function statusOf(s: SessionView, waiting: boolean, stale: boolean): Status {
  if (s.status === "lost") return { label: "lost", color: "var(--text-faint)" };
  if (waiting) return { label: "waiting for you", color: "rgb(var(--accent))" };
  if (s.working && !stale) return { label: "working…", color: "rgb(var(--primary-soft))" };
  return { label: "idle", color: "var(--text-soft)" };
}

/**
 * Alt-Tab / Cmd-Tab style session switcher. Opened by the session-cycle shortcut
 * (Ctrl+Tab): stays up while the modifier is held, each Tab moves the highlight, and
 * releasing the modifier commits (see useKeybindings). Shows a preview of the
 * highlighted session so you know what you're selecting before you land on it.
 */
export default function SessionSwitcher() {
  const switcher = useStore((s) => s.switcher);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);
  const workingStale = useStore((s) => s.workingStale);
  const selRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted tile scrolled into view as you tab through.
  useEffect(() => { selRef.current?.scrollIntoView({ block: "nearest", inline: "center" }); }, [switcher?.index]);

  if (!switcher) return null;
  const find = (id: string) => sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);
  const items = switcher.ids.map(find).filter(Boolean) as SessionView[];
  if (items.length === 0) return null;
  const sel = items[Math.min(switcher.index, items.length - 1)];
  // store.decisions holds only pending decisions; an actionable one → "waiting".
  const waitingFor = (id: string) => decisions.some((d) => d.sessionId === id && (d.kind === "question" || d.kind === "permission"));
  const selStatus = statusOf(sel, waitingFor(sel.id), !!workingStale[sel.id]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 6000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}>
      <div className="glass-menu" style={{ width: 720, maxWidth: "92vw", borderRadius: 18, border: "1px solid var(--border-strong)", boxShadow: "0 30px 80px rgba(0,0,0,0.6)", padding: 18, background: "color-mix(in srgb, var(--app-panel) 95%, transparent)" }}>
        {/* Tile strip */}
        <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {items.map((s, i) => {
            const on = i === switcher.index;
            const st = statusOf(s, waitingFor(s.id), !!workingStale[s.id]);
            return (
              <div
                key={s.id}
                ref={on ? selRef : undefined}
                style={{
                  flex: "0 0 auto", width: 150, padding: "12px 12px", borderRadius: 12, cursor: "default",
                  border: `1px solid ${on ? "rgb(var(--primary-soft))" : "var(--border)"}`,
                  background: on ? "rgb(var(--primary) / 0.2)" : "rgba(255,255,255,0.03)",
                  boxShadow: on ? "0 0 0 1px rgb(var(--primary-soft) / 0.5)" : "none",
                  transition: "background .12s, border-color .12s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: st.color, flexShrink: 0 }} />
                  <span className="display" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName(s.cwd)}</span>
                </div>
                <div className="mono faint" style={{ fontSize: 9.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.machine}</div>
                <div className="mono" style={{ fontSize: 9.5, color: st.color, marginTop: 3 }}>{st.label}</div>
              </div>
            );
          })}
        </div>

        {/* Preview of the highlighted session */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="display" style={{ fontSize: 18 }}>{projectName(sel.cwd)}</span>
            <span className="mono faint" style={{ fontSize: 11 }}>{sel.machine}{sel.gitBranch ? ` · ${sel.gitBranch}` : ""}{sel.wrapperId ? ` · rcw-${sel.wrapperId}` : ""}</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11, color: selStatus.color }}>● {selStatus.label}</span>
          </div>
          <div className="mono faint" style={{ fontSize: 10.5, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel.cwd}</div>
          <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-soft)", maxHeight: 66, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
            {sel.latestAnswer ? sel.latestAnswer.replace(/\s+/g, " ").slice(0, 260) : <span className="faint" style={{ fontStyle: "italic" }}>No messages yet.</span>}
          </div>
        </div>

        <div className="mono faint" style={{ fontSize: 10, marginTop: 12, textAlign: "center", letterSpacing: "0.06em" }}>
          Hold to keep open · Tab / Shift+Tab to move · release to select · Esc cancels
        </div>
      </div>
    </div>
  );
}
