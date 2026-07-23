import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";
import SciFiSpinner from "./SciFiSpinner";

// A futuristic live feed of the focused session's activity, derived from the transcript
// we already receive (assistant prose + edit snippets + "$ command" lines + user
// prompts). It's a desktop-only view — a richer raw tool stream (every Bash/Read/Grep)
// would need the hook to emit it, a follow-up. Renders as a scrolling HUD console.

type Kind = "prompt" | "say" | "edit" | "exec";
type Act = { key: string; kind: Kind; label: string; icon: string; detail: string };

const META: Record<Kind, { color: string }> = {
  prompt: { color: "var(--text-soft)" },
  say: { color: "rgb(var(--primary-soft))" },
  edit: { color: "rgb(var(--accent))" },
  exec: { color: "rgb(var(--primary-soft))" },
};

/** Turn the transcript into a flat activity stream. Best-effort parsing of the
 *  markdown the hook produces (edits render as "**✎ path**", commands as "$ cmd"). */
export function deriveActivity(transcript: { role: string; text: string }[]): Act[] {
  const acts: Act[] = [];
  transcript.forEach((m, mi) => {
    const text = m.text ?? "";
    if (m.role === "user") {
      const t = text.trim();
      if (t && !t.startsWith("$")) acts.push({ key: `u${mi}`, kind: "prompt", label: "PROMPT", icon: "▸", detail: t.slice(0, 200) });
      return;
    }
    // Edits: "**✎ path**" (formatEditTool output).
    const editRe = /\*\*✎ (.+?)\*\*/g;
    let em: RegExpExecArray | null;
    let ei = 0;
    while ((em = editRe.exec(text))) acts.push({ key: `e${mi}-${ei++}`, kind: "edit", label: "EDIT", icon: "✎", detail: em[1] });
    // Commands: "$ cmd" lines (renderCommandString output).
    text.split("\n").forEach((line, li) => {
      const c = line.match(/^\$ (.+)/);
      if (c) acts.push({ key: `c${mi}-${li}`, kind: "exec", label: "EXEC", icon: "❯", detail: c[1].slice(0, 200) });
    });
    // Remaining prose, with edit/diff/code blocks + command lines stripped out.
    const prose = text
      .replace(/\*\*✎[\s\S]*?```diff[\s\S]*?```/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/^\$ .*$/gm, "")
      .replace(/\*\*✎ .*?\*\*/g, "")
      .trim();
    if (prose) acts.push({ key: `s${mi}`, kind: "say", label: "CLAUDE", icon: "◇", detail: prose.slice(0, 260) });
  });
  return acts;
}

const CSS = `
@keyframes rcw-af-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
.rcw-af { display:flex; flex-direction:column; height:100%; min-height:0; }
.rcw-af-hd { display:flex; align-items:center; gap:9px; padding: 9px 12px; border-bottom:1px solid var(--border); flex-shrink:0; }
.rcw-af-body { flex:1; min-height:0; overflow-y:auto; padding: 8px 12px; display:flex; flex-direction:column; gap:6px; }
.rcw-af-row { display:flex; gap:9px; align-items:flex-start; animation: rcw-af-in .16s ease both; }
.rcw-af-badge { flex-shrink:0; font-family:var(--font-mono); font-size:8.5px; letter-spacing:.12em; padding:2px 6px; border-radius:5px;
  border:1px solid var(--border); background: rgb(var(--primary) / 0.06); text-transform:uppercase; margin-top:1px; }
.rcw-af-detail { font-size:12px; line-height:1.5; color:var(--text); min-width:0; overflow-wrap:anywhere; white-space:pre-wrap; }
.rcw-af-detail.mono { font-family:var(--font-mono); font-size:11px; color:var(--text-soft); }
`;

export default function ActionFeed({ active = true }: { sessionId?: string; active?: boolean }) {
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const focusId = useStore((s) => s.focusId);
  const workingStale = useStore((s) => s.workingStale);
  const session = sessions.find((x) => x.id === focusId) ?? queue.find((x) => x.id === focusId);
  const working = !!session?.working && !(session && workingStale[session.id]);

  const acts = useMemo(() => (session ? deriveActivity(session.transcript ?? []) : []), [session]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onScroll = () => {
    const el = bodyRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  useEffect(() => {
    if (active && stick.current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [acts, active, working]);

  return (
    <div className="rcw-af">
      <style>{CSS}</style>
      <div className="rcw-af-hd">
        <span style={{ fontSize: 13 }}>⚡</span>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>
          Activity Stream{session ? ` · ${session.machine}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {working && <SciFiSpinner size={16} />}
        <span className="mono faint" style={{ fontSize: 9.5 }}>{acts.length} events</span>
      </div>
      <div className="rcw-af-body no-scrollbar" ref={bodyRef} onScroll={onScroll}>
        {!session ? (
          <span className="mono faint" style={{ fontSize: 11.5, padding: "10px 2px" }}>Select a session to watch its activity.</span>
        ) : acts.length === 0 ? (
          <span className="mono faint" style={{ fontSize: 11.5, padding: "10px 2px" }}>No activity yet.</span>
        ) : (
          acts.map((a) => (
            <div key={a.key} className="rcw-af-row">
              <span className="rcw-af-badge" style={{ color: META[a.kind].color, borderColor: "color-mix(in srgb, currentColor 40%, transparent)" }}>
                {a.icon} {a.label}
              </span>
              <span className={`rcw-af-detail${a.kind === "edit" || a.kind === "exec" ? " mono" : ""}`}>{a.detail}</span>
            </div>
          ))
        )}
        {working && (
          <div className="rcw-af-row">
            <span className="rcw-af-badge" style={{ color: "rgb(var(--primary-soft))" }}>◇ live</span>
            <span className="rcw-af-detail mono" style={{ color: "var(--text-faint)" }}>working…</span>
          </div>
        )}
      </div>
    </div>
  );
}
