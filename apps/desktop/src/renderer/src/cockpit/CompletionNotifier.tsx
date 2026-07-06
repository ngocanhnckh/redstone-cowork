import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import Markdown from "./Markdown";

/**
 * HUD-only completion alerts. When a background session finishes a turn (its
 * `working` flag flips true → false) it slides in a futuristic notification card
 * with a peek of the final answer. The user can jump straight to that session
 * (to read it / answer a pending question) or dismiss the card. Cards auto-expire
 * so they never pile up. The currently-focused session is skipped — you're already
 * looking at it.
 */

type Note = {
  key: number;
  sessionId: string;
  project: string;
  meta: string;
  answer: string;
  needsAnswer: boolean;
};

const AUTO_DISMISS_MS = 15_000;
const MAX_CARDS = 4;
const projectName = (cwd: string): string => cwd.split("/").filter(Boolean).pop() ?? cwd;

const CSS = `
@keyframes cn-in { from { opacity:0; transform: translateX(28px) scale(.96); } to { opacity:1; transform:none; } }
@keyframes cn-sheen { from { background-position: -140% 0; } to { background-position: 240% 0; } }
.cn-card { animation: cn-in .34s cubic-bezier(.2,.9,.2,1) both; position: relative; overflow: hidden;
  border:1px solid rgb(var(--primary-soft) / 0.45); border-radius:14px; padding:12px 13px 11px;
  box-shadow: 0 14px 44px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(var(--primary-soft) / 0.12), inset 0 0 26px -18px rgb(var(--primary-soft)); }
.cn-card::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background: linear-gradient(115deg, transparent 30%, rgb(var(--primary-soft) / 0.14) 48%, transparent 66%);
  background-size: 220% 100%; animation: cn-sheen 3.6s ease-in-out infinite; }
.cn-card.cn-ask { border-color: rgb(var(--accent) / 0.6); box-shadow: 0 14px 44px rgb(0 0 0 / 0.5), 0 0 22px -8px rgb(var(--accent) / 0.7); }
.cn-jump { border:1px solid rgb(var(--primary-soft) / 0.5); background: rgb(var(--primary) / 0.28); color:#fff;
  border-radius:9px; padding:5px 12px; font-size:11.5px; font-weight:600; cursor:pointer; font-family:var(--font-mono);
  transition: background .15s, box-shadow .15s; }
.cn-jump:hover { background: rgb(var(--primary) / 0.45); box-shadow: 0 0 16px -4px rgb(var(--primary-soft)); }
.cn-x { border:1px solid var(--border); background:transparent; color:var(--text-soft); border-radius:9px;
  padding:5px 10px; font-size:11.5px; cursor:pointer; font-family:var(--font-mono); }
.cn-x:hover { color: var(--text); }
`;

export default function CompletionNotifier() {
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);
  const focusId = useStore((s) => s.focusId);
  const setFocus = useStore((s) => s.setFocus);

  const [notes, setNotes] = useState<Note[]>([]);
  const prevWorking = useRef<Map<string, boolean>>(new Map());
  const seq = useRef(0);
  const primed = useRef(false); // skip the very first pass (avoid notifying for pre-existing completions)
  const focusRef = useRef(focusId);
  focusRef.current = focusId;

  useEffect(() => {
    const all = Array.from(new Map([...sessions, ...queue].map((s) => [s.id, s])).values());
    const actionable = new Set(
      decisions.filter((d) => d.kind === "question" || d.kind === "permission" || d.kind === "mode").map((d) => d.sessionId),
    );
    const fresh: Note[] = [];
    for (const s of all) {
      const was = prevWorking.current.get(s.id);
      prevWorking.current.set(s.id, !!s.working);
      // Completion = working went true → false. Skip the focused session (already visible).
      if (primed.current && was === true && s.working === false && s.id !== focusRef.current) {
        const last = [...(s.transcript ?? [])].reverse().find((m) => m.role === "assistant")?.text;
        fresh.push({
          key: ++seq.current,
          sessionId: s.id,
          project: projectName(s.cwd),
          meta: `${s.machine} · ${s.gitBranch ?? "no branch"}`,
          answer: (s.latestAnswer || last || "").slice(0, 320),
          needsAnswer: actionable.has(s.id),
        });
      }
    }
    primed.current = true;
    if (fresh.length) setNotes((cur) => [...cur, ...fresh].slice(-MAX_CARDS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, queue, decisions]);

  // Auto-expire each card.
  useEffect(() => {
    if (notes.length === 0) return;
    const timers = notes.map((n) => setTimeout(() => setNotes((cur) => cur.filter((x) => x.key !== n.key)), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.map((n) => n.key).join(",")]);

  const dismiss = (key: number) => setNotes((cur) => cur.filter((x) => x.key !== key));
  const jump = (n: Note) => { setFocus(n.sessionId); dismiss(n.key); };

  if (notes.length === 0) return null;

  return (
    <div style={{ position: "absolute", top: 14, right: 16, zIndex: 4000, display: "flex", flexDirection: "column", gap: 10, width: 340, maxWidth: "42vw", pointerEvents: "none" }}>
      <style>{CSS}</style>
      {notes.map((n) => (
        <div key={n.key} className={`cn-card glass-surface${n.needsAnswer ? " cn-ask" : ""}`} style={{ pointerEvents: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
            <span className="ai-core" style={{ width: 15, height: 15, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: n.needsAnswer ? "rgb(var(--accent))" : "rgb(var(--primary-soft))" }}>
                {n.needsAnswer ? "needs your answer" : "session complete"}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                <span className="display" style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.project}</span>
                <span className="mono faint" style={{ fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{n.meta}</span>
              </div>
            </div>
            <button className="cn-x" onClick={() => dismiss(n.key)} title="Dismiss">✕</button>
          </div>
          {n.answer && (
            <div className="no-scrollbar" style={{ maxHeight: 108, overflowY: "auto", fontSize: 11.5, lineHeight: 1.5, color: "var(--text-soft)", margin: "0 0 10px", position: "relative", zIndex: 1 }}>
              <Markdown>{n.answer}</Markdown>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", position: "relative", zIndex: 1 }}>
            <button className="cn-jump" onClick={() => jump(n)}>{n.needsAnswer ? "Jump & answer →" : "Jump to session →"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
