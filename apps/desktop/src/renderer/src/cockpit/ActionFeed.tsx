import { useEffect, useMemo, useRef, useState } from "react";
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
.rcw-af { position:relative; display:flex; flex-direction:column; height:100%; min-height:0; }
.rcw-af-hd { display:flex; align-items:center; gap:9px; padding: 9px 12px; border-bottom:1px solid var(--border); flex-shrink:0; }
.rcw-af-body { flex:1; min-height:0; overflow-y:auto; padding: 8px 12px; display:flex; flex-direction:column; gap:6px; }
.rcw-af-row { display:flex; gap:9px; align-items:flex-start; animation: rcw-af-in .16s ease both; }
.rcw-af-badge { flex-shrink:0; font-family:var(--font-mono); font-size:8.5px; letter-spacing:.12em; padding:2px 6px; border-radius:5px;
  border:1px solid var(--border); background: rgb(var(--primary) / 0.06); text-transform:uppercase; margin-top:1px; }
.rcw-af-detail { font-size:12px; line-height:1.5; color:var(--text); min-width:0; overflow-wrap:anywhere; white-space:pre-wrap; }
.rcw-af-detail.mono { font-family:var(--font-mono); font-size:11px; color:var(--text-soft); }

/* ── Relay overlay: the periodic full-window "incoming transmission" replay ── */
.rcw-relay-ov { position:absolute; inset:0; z-index:6; display:flex; flex-direction:column; padding:14px 16px 12px; gap:9px;
  overflow:hidden; animation: rcw-relay-fade .28s ease both;
  background: radial-gradient(120% 90% at 50% 0%, rgb(var(--primary) / 0.16), rgba(6,7,9,0.9) 70%), rgba(6,7,9,0.94); backdrop-filter: blur(3px); }
@keyframes rcw-relay-fade { from { opacity:0; } to { opacity:1; } }
.rcw-relay-grid { position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image: linear-gradient(rgb(var(--primary-soft) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--primary-soft) / 0.06) 1px, transparent 1px);
  background-size: 30px 30px; mask-image: radial-gradient(80% 80% at 50% 40%, #000 40%, transparent 85%);
  -webkit-mask-image: radial-gradient(80% 80% at 50% 40%, #000 40%, transparent 85%); }
.rcw-relay-ov::after { content:""; position:absolute; left:0; right:0; height:2px; z-index:3; pointer-events:none;
  background: linear-gradient(90deg, transparent, rgb(var(--primary-soft) / 0.75), transparent);
  box-shadow: 0 0 16px 3px rgb(var(--primary-soft) / 0.45); animation: rcw-relay-scan 2.4s linear infinite; }
@keyframes rcw-relay-scan { 0% { top:-3%; } 100% { top:103%; } }
.rcw-relay-hd { display:flex; align-items:center; gap:9px; position:relative; z-index:2; }
.rcw-relay-tag { font-family:var(--font-mono); font-size:11px; letter-spacing:.24em; text-transform:uppercase;
  color: rgb(var(--accent)); text-shadow:0 0 12px rgb(var(--accent) / 0.6); }
.rcw-relay-dot { width:8px; height:8px; border-radius:50%; background: rgb(var(--accent)); box-shadow:0 0 10px 1px rgb(var(--accent));
  animation: rcw-relay-blink 1s steps(1) infinite; }
@keyframes rcw-relay-blink { 50% { opacity:.2; } }
.rcw-relay-body { position:relative; z-index:2; flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:2px; }
.rcw-relay-item { display:flex; flex-direction:column; gap:3px; animation: rcw-af-in .2s ease both; }
.rcw-relay-line { font-family:var(--font-mono); font-size:13px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; color: var(--text); }
.rcw-relay-scr { color: rgb(var(--primary-soft) / 0.5); }
.rcw-relay-cur { display:inline-block; width:8px; color: rgb(var(--accent)); animation: rcw-relay-blink .7s steps(1) infinite; }
.rcw-relay-badge { align-self:flex-start; font-family:var(--font-mono); font-size:8.5px; letter-spacing:.12em; color: var(--text-soft);
  border:1px solid color-mix(in srgb, currentColor 40%, transparent); border-radius:5px; padding:1px 6px; text-transform:uppercase; }
.rcw-relay-ft { display:flex; align-items:center; gap:8px; position:relative; z-index:2; font-family:var(--font-mono); font-size:9px;
  letter-spacing:.14em; text-transform:uppercase; color: var(--text-soft); }
.rcw-relay-bar { flex:1; height:3px; border-radius:99px; overflow:hidden; background: rgb(var(--primary-soft) / 0.12); }
.rcw-relay-bar > i { display:block; height:100%; background: linear-gradient(90deg, rgb(var(--primary-soft)), rgb(var(--accent)));
  box-shadow: 0 0 10px 1px rgb(var(--primary-soft) / 0.7); transition: width .4s ease; }
.rcw-relay-chip { font-family:var(--font-mono); font-size:9px; letter-spacing:.1em; color: rgb(var(--accent) / 0.9);
  border:1px solid color-mix(in srgb, rgb(var(--accent)) 35%, transparent); border-radius:99px; padding:1px 8px; }
`;

// How long a line takes to "decode" (ms per char, clamped) — shared by the animation
// and the parent's advance timer so they stay in lockstep.
const GLYPHS = "01<>/\\|=+*#%$&░▒▓";
function decodeMs(text: string): number {
  const per = Math.max(11, Math.min(40, 820 / Math.max(1, text.length)));
  return Math.round(text.length * per);
}

/** A single line that resolves from scrambled glyphs into the real text, left→right,
 *  like a decrypting terminal readout. Purely cosmetic; re-runs when `text` changes. */
function DecodeLine({ text }: { text: string }) {
  const [n, setN] = useState(0);   // characters resolved so far
  const [, setTick] = useState(0); // drives the glyph flicker on the unresolved tail
  useEffect(() => {
    setN(0);
    const total = text.length;
    const per = Math.max(11, Math.min(40, 820 / Math.max(1, total)));
    const id = setInterval(() => setN((v) => {
      if (v >= total) { clearInterval(id); return v; }
      return v + 1;
    }), per);
    return () => clearInterval(id);
  }, [text]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 55); return () => clearInterval(id); }, []);

  const done = n >= text.length;
  const head = text.slice(0, n);
  const tail = text.slice(n).replace(/\S/g, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]);
  return (
    <div className="rcw-relay-line">
      <span>{head}</span>
      {!done && <span className="rcw-relay-cur">▋</span>}
      <span className="rcw-relay-scr">{tail}</span>
    </div>
  );
}

const RELAY_MS = 30_000;
const RELAY_COUNT = 10; // replay at least the last 10 Claude activities per cycle

/** Drives the periodic replay: every 30s it queues the last N Claude activities and
 *  steps through them (each lingers after decoding). Parked while the panel is hidden. */
function useRelay(acts: Act[], active: boolean) {
  const [queue, setQueue] = useState<Act[]>([]);
  const [idx, setIdx] = useState(0);
  const [secs, setSecs] = useState(RELAY_MS / 1000);
  const actsRef = useRef(acts); actsRef.current = acts;

  useEffect(() => {
    if (!active) return;
    const fire = () => {
      const recent = actsRef.current.filter((a) => a.kind !== "prompt").slice(-RELAY_COUNT);
      if (recent.length) { setQueue(recent); setIdx(0); }
    };
    let s = RELAY_MS / 1000;
    const kickoff = setTimeout(fire, 1400);
    const id = setInterval(() => {
      s = s <= 1 ? RELAY_MS / 1000 : s - 1;
      if (s === RELAY_MS / 1000) fire();
      setSecs(s);
    }, 1000);
    return () => { clearInterval(id); clearTimeout(kickoff); };
  }, [active]);

  // Advance through the queue; shorter lines get a shorter linger so 10 lines don't drag.
  useEffect(() => {
    if (!queue.length) return;
    const item = queue[idx];
    if (!item) return;
    const t = setTimeout(() => {
      if (idx + 1 < queue.length) setIdx((i) => i + 1);
      else setQueue([]);
    }, decodeMs(item.detail) + 900);
    return () => clearTimeout(t);
  }, [queue, idx]);

  return { queue, idx, secs, playing: queue.length > 0 && !!queue[idx] };
}

/** The full-window "incoming transmission" overlay — covers the whole Activity panel
 *  while a replay is playing, streaming each queued line with the decode animation. */
function RelayOverlay({ queue, idx }: { queue: Act[]; idx: number }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Keep the newest decoding line in view as the transmission builds up.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [idx]);
  const pct = Math.round(((idx + 1) / queue.length) * 100);
  return (
    <div className="rcw-relay-ov">
      <span className="rcw-relay-grid" />
      <div className="rcw-relay-hd">
        <span className="rcw-relay-dot" />
        <span className="rcw-relay-tag">◈ Incoming transmission</span>
        <span style={{ flex: 1 }} />
        <span className="rcw-relay-chip">replay · recent output</span>
      </div>
      <div className="rcw-relay-body no-scrollbar" ref={bodyRef}>
        {queue.slice(0, idx + 1).map((a, i) => (
          <div key={a.key + i} className="rcw-relay-item">
            <span className="rcw-relay-badge" style={{ color: META[a.kind].color }}>{a.icon} {a.label}</span>
            {i < idx
              ? <div className="rcw-relay-line" style={{ opacity: 0.72 }}>{a.detail}</div>
              : <DecodeLine text={a.detail} />}
          </div>
        ))}
      </div>
      <div className="rcw-relay-ft">
        <span>relay {idx + 1}/{queue.length}</span>
        <span className="rcw-relay-bar"><i style={{ width: `${pct}%` }} /></span>
        <span>◇ live</span>
      </div>
    </div>
  );
}

export default function ActionFeed({ active = true }: { sessionId?: string; active?: boolean }) {
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const focusId = useStore((s) => s.focusId);
  const workingStale = useStore((s) => s.workingStale);
  const session = sessions.find((x) => x.id === focusId) ?? queue.find((x) => x.id === focusId);
  const working = !!session?.working && !(session && workingStale[session.id]);

  const acts = useMemo(() => (session ? deriveActivity(session.transcript ?? []) : []), [session]);
  const relay = useRelay(acts, active && !!session);

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
        {!relay.playing && acts.length > 0 && (
          <span className="mono faint" style={{ fontSize: 9, letterSpacing: "0.1em" }} title="Next transmission replay">◈ {relay.secs}s</span>
        )}
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
      {relay.playing && <RelayOverlay queue={relay.queue} idx={relay.idx} />}
    </div>
  );
}
