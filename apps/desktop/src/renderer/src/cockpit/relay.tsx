import { useEffect, useRef, useState } from "react";

// Shared "incoming transmission" replay: every 30s a full-window overlay re-streams
// the last N items with a decode/typewriter animation, so a quiet panel still feels
// alive. Used by the Activity app and the Docker log app. The replay is GATED — it
// only fires when the panel has been quiet for a few seconds AND the user isn't
// interacting, and any fresh activity or interaction cancels an in-progress replay.

export type RelayItem = { key: string; label: string; icon: string; color: string; detail: string };

export const RELAY_MS = 30_000;   // replay cycle
export const RELAY_COUNT = 10;    // how many recent items to replay

const GLYPHS = "01<>/\\|=+*#%$&░▒▓";
export function decodeMs(text: string): number {
  const per = Math.max(11, Math.min(40, 820 / Math.max(1, text.length)));
  return Math.round(text.length * per);
}

/** A line that resolves from scrambled glyphs into the real text, left→right. */
export function DecodeLine({ text }: { text: string }) {
  const [n, setN] = useState(0);
  const [, setTick] = useState(0);
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

/**
 * Drives the periodic replay. Fires every 30s but ONLY when not `suppressed` — each
 * panel passes its own "busy" signal (constant new activity) OR the user interacting
 * (scrolling). Becoming suppressed also cancels a replay already in progress. A quick
 * kickoff makes it feel live shortly after the panel opens. Parked while `active` false.
 */
export function useRelay(items: RelayItem[], active: boolean, suppressed: boolean) {
  const [queue, setQueue] = useState<RelayItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [secs, setSecs] = useState(RELAY_MS / 1000);
  const itemsRef = useRef(items); itemsRef.current = items;
  const suppRef = useRef(suppressed); suppRef.current = suppressed;
  const playingRef = useRef(false);
  playingRef.current = queue.length > 0 && !!queue[idx];

  // New activity or user interaction cancels any running replay immediately.
  useEffect(() => { if (suppressed && playingRef.current) setQueue([]); }, [suppressed]);

  // 1s heartbeat: countdown + a gated fire every 30s (plus a kickoff). Parked when hidden.
  useEffect(() => {
    if (!active) return;
    const tryFire = () => {
      if (suppRef.current) return;
      const recent = itemsRef.current.slice(-RELAY_COUNT);
      if (recent.length) { setQueue(recent); setIdx(0); }
    };
    const kickoff = setTimeout(tryFire, 1800);
    let s = RELAY_MS / 1000;
    const id = setInterval(() => {
      s = s <= 1 ? RELAY_MS / 1000 : s - 1;
      if (s === RELAY_MS / 1000) tryFire();
      setSecs(s);
    }, 1000);
    return () => { clearInterval(id); clearTimeout(kickoff); };
  }, [active]);

  // Step through the queue; each line lingers briefly after decoding.
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
        background: radial-gradient(120% 90% at 50% 0%, rgb(var(--primary) / 0.16), rgba(6,7,9,0.9) 70%), rgba(6,7,9,0.94); backdrop-filter: blur(3px); }
      @keyframes rcw-relay-fade { from { opacity:0; } to { opacity:1; } }
      @keyframes rcw-relay-item-in { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:none; } }
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
      .rcw-relay-item { display:flex; flex-direction:column; gap:3px; animation: rcw-relay-item-in .2s ease both; }
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
      body.rcw-hidden .rcw-relay-ov::after, body.rcw-hidden .rcw-relay-dot, body.rcw-hidden .rcw-relay-cur { animation-play-state: paused !important; }
    `}</style>
  );
}
