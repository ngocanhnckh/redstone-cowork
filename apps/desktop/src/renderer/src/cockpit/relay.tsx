import { useEffect, useRef, useState } from "react";

// Shared "incoming transmission" replay overlay: re-streams the last N items with a
// teletype animation. Used by the Activity app and the Docker log app.
//
// Signal Room register: the automatic idle-triggered replay loop is DISABLED — the
// overlay only plays when explicitly triggered (a caller seeding the queue). Liveness
// comes from real data movement, not idle loops.

export type RelayItem = { key: string; label: string; icon: string; color: string; detail: string };

export const RELAY_MS = 30_000;   // legacy cycle length (auto replay is disabled)
export const RELAY_COUNT = 10;    // how many recent items to replay

// Teletype pacing: 14–40ms per character, with a beat (~+110ms) after punctuation.
const PAUSE_RE = /[.,—·]/;
const CHAR_MIN = 14, CHAR_MAX = 40, PAUSE_MS = 110;
const AVG_CHAR = (CHAR_MIN + CHAR_MAX) / 2;
function charDelay(c: string): number {
  const base = CHAR_MIN + Math.random() * (CHAR_MAX - CHAR_MIN);
  return PAUSE_RE.test(c) ? base + PAUSE_MS : base;
}
/** Estimated total type-out time for a line (drives the queue step timing). */
export function decodeMs(text: string): number {
  let ms = 0;
  for (const c of text) ms += PAUSE_RE.test(c) ? AVG_CHAR + PAUSE_MS : AVG_CHAR;
  return Math.round(ms);
}

/** A line typed out character by character, left→right, with a cursor at the tip. */
export function DecodeLine({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    let i = 0;
    let t: ReturnType<typeof setTimeout> | null = null;
    const step = () => {
      if (i >= text.length) { t = null; return; }
      const c = text[i];
      i += 1;
      setN(i);
      t = setTimeout(step, charDelay(c));
    };
    t = setTimeout(step, CHAR_MIN);
    return () => { if (t) clearTimeout(t); };
  }, [text]);

  const done = n >= text.length;
  return (
    <div className="rcw-relay-line">
      <span>{text.slice(0, n)}</span>
      {!done && <span className="rcw-relay-cur">▍</span>}
    </div>
  );
}

/**
 * Replay driver. The automatic idle-triggered replay (30s cycle / continuous loop)
 * is disabled — the hook never seeds its own queue. The stepping machinery is kept
 * intact so a manual trigger (a caller calling setQueue via a future API, or tests)
 * still plays through and can be dismissed; becoming `suppressed` cancels an
 * in-progress replay immediately.
 */
export function useRelay(items: RelayItem[], active: boolean, suppressed: boolean, opts?: { loop?: boolean }) {
  void items; void active; void opts; // auto-replay disabled; kept for API compatibility
  const [queue, setQueue] = useState<RelayItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [secs] = useState(RELAY_MS / 1000);
  const playingRef = useRef(false);
  playingRef.current = queue.length > 0 && !!queue[idx];

  // New activity or user interaction cancels any running replay immediately.
  useEffect(() => { if (suppressed && playingRef.current) setQueue([]); }, [suppressed]);

  // Step through the queue; each line lingers briefly after typing out, then the
  // replay ends (no looping re-run).
  useEffect(() => {
    if (!queue.length) return;
    const item = queue[idx];
    if (!item) return;
    const t = setTimeout(() => {
      if (idx + 1 < queue.length) { setIdx((i) => i + 1); return; }
      setQueue([]);
    }, decodeMs(item.detail) + 900);
    return () => clearTimeout(t);
  }, [queue, idx]);

  return { queue, idx, secs, playing: queue.length > 0 && !!queue[idx], dismiss: () => setQueue([]) };
}

/** The full-window overlay shown while a replay plays. Click / scroll anywhere on it
 *  dismisses back to the live view. */
export function RelayOverlay({ queue, idx, title, onDismiss }: { queue: RelayItem[]; idx: number; title: string; onDismiss: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [idx]);
  const pct = Math.round(((idx + 1) / queue.length) * 100);
  return (
    <div className="rcw-relay-ov" onClick={onDismiss} onWheel={onDismiss} title="click to dismiss">
      <span className="rcw-relay-grid" />
      <div className="rcw-relay-hd">
        <span className="rcw-relay-dot" />
        <span className="rcw-relay-tag">◈ {title}</span>
        <span style={{ flex: 1 }} />
        <span className="rcw-relay-chip">replay · recent</span>
      </div>
      <div className="rcw-relay-body no-scrollbar" ref={bodyRef}>
        {queue.slice(0, idx + 1).map((a, i) => (
          <div key={a.key + i} className="rcw-relay-item">
            <span className="rcw-relay-badge" style={{ color: a.color }}>{a.icon} {a.label}</span>
            {i < idx
              ? <div className="rcw-relay-line" style={{ opacity: 0.72 }}>{a.detail}</div>
              : <DecodeLine text={a.detail} />}
          </div>
        ))}
      </div>
      <div className="rcw-relay-ft">
        <span>relay {idx + 1}/{queue.length}</span>
        <span className="rcw-relay-bar"><i style={{ width: `${pct}%` }} /></span>
        <span className="faint">click to dismiss</span>
      </div>
    </div>
  );
}

/** The shared relay overlay styles. Render once per panel that uses the overlay. */
export function RelayStyles() {
  return (
    <style>{`
      .rcw-relay-ov { position:absolute; inset:0; z-index:6; display:flex; flex-direction:column; padding:14px 16px 12px; gap:9px;
        overflow:hidden; cursor:pointer; animation: rcw-relay-fade .28s ease both;
        background: rgba(6,7,9,0.94); backdrop-filter: blur(3px); }
      @keyframes rcw-relay-fade { from { opacity:0; } to { opacity:1; } }
      @keyframes rcw-relay-item-in { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:none; } }
      .rcw-relay-grid { position:absolute; inset:0; pointer-events:none; opacity:.5;
        background-image: linear-gradient(rgb(var(--primary-soft) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--primary-soft) / 0.06) 1px, transparent 1px);
        background-size: 30px 30px; mask-image: radial-gradient(80% 80% at 50% 40%, #000 40%, transparent 85%);
        -webkit-mask-image: radial-gradient(80% 80% at 50% 40%, #000 40%, transparent 85%); }
      .rcw-relay-hd { display:flex; align-items:center; gap:9px; position:relative; z-index:2; }
      .rcw-relay-tag { font-family:var(--font-mono); font-size:11px; letter-spacing:.24em; text-transform:uppercase;
        color: rgb(var(--accent)); }
      .rcw-relay-dot { width:8px; height:8px; border-radius:50%; background: rgb(var(--accent)); }
      .rcw-relay-body { position:relative; z-index:2; flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:2px; }
      .rcw-relay-item { display:flex; flex-direction:column; gap:3px; animation: rcw-relay-item-in .2s ease both; }
      .rcw-relay-line { font-family:var(--font-mono); font-size:13px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; color: var(--text); }
      .rcw-relay-cur { display:inline-block; width:8px; color: rgb(var(--accent)); animation: rcw-relay-blink .7s steps(1) infinite; }
      @keyframes rcw-relay-blink { 50% { opacity:.15; } }
      .rcw-relay-badge { align-self:flex-start; font-family:var(--font-mono); font-size:8.5px; letter-spacing:.12em; color: var(--text-soft);
        border:1px solid color-mix(in srgb, currentColor 40%, transparent); border-radius:5px; padding:1px 6px; text-transform:uppercase; }
      .rcw-relay-ft { display:flex; align-items:center; gap:8px; position:relative; z-index:2; font-family:var(--font-mono); font-size:9px;
        letter-spacing:.14em; text-transform:uppercase; color: var(--text-soft); }
      .rcw-relay-bar { flex:1; height:3px; border-radius:99px; overflow:hidden; background: rgb(var(--primary-soft) / 0.12); }
      .rcw-relay-bar > i { display:block; height:100%; background: var(--text-soft); transition: width .4s ease; }
      .rcw-relay-chip { font-family:var(--font-mono); font-size:9px; letter-spacing:.1em; color: var(--text-soft);
        border:1px solid var(--border-strong); border-radius:99px; padding:1px 8px; }
      body.rcw-hidden .rcw-relay-cur { animation-play-state: paused !important; }
    `}</style>
  );
}
