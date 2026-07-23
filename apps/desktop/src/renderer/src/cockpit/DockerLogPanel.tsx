import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { DockerContainer, DockerHostView } from "../types";
import { bestDockerHost } from "./dockerHost";
import { playSfx } from "../sfx";
import { useRelay, RelayOverlay, RelayStyles, RELAY_COUNT, type RelayItem } from "./relay";

const IDLE_RETURN_MS = 60_000; // after scrolling up, resume tailing after 1 min idle
const RETRY_MS = 30_000; // auto-reconnect this long after a log stream ends (e.g. container restarted)
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split `text` into React nodes, wrapping case-insensitive matches of `query` in
 * <mark> (the active match tinted differently). Returns the node list + match count. */
function highlight(text: string, query: string, current: number): { nodes: React.ReactNode[]; count: number } {
  const nodes: React.ReactNode[] = [];
  let re: RegExp;
  try { re = new RegExp(escapeRegExp(query), "gi"); } catch { return { nodes: [text], count: 0 }; }
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const idx = i++;
    const active = idx === current;
    nodes.push(
      <mark key={idx} data-mi={idx} style={{ background: active ? "rgb(var(--accent))" : "rgb(var(--primary-soft) / 0.4)", color: active ? "#000" : "inherit", borderRadius: 2 }}>{m[0]}</mark>,
    );
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-length matches
  }
  if (last < text.length) nodes.push(text.slice(last));
  return { nodes, count: i };
}

const MAX_LINES = 1600; // trim the rendered buffer so a chatty container can't grow unbounded
const HIST = 48; // samples kept for the status sparklines (~4 min at the 5s poll)

type LogLevel = "err" | "warn" | "info" | "debug" | null;
type LogLine = { id: number; text: string; anim: boolean; lvl: LogLevel };

/** Best-effort log level from a line's content — drives its colour (see DLOG_CSS). */
function levelOf(s: string): LogLevel {
  if (/\b(error|err|fatal|panic|exception|fail(ed|ure)?|\b5\d\d\b)\b/i.test(s)) return "err";
  if (/\b(warn(ing)?|deprecat|retry|\b4\d\d\b)\b/i.test(s)) return "warn";
  if (/\b(debug|trace|verbose)\b/i.test(s)) return "debug";
  if (/\b(info|ready|listening|started|success|done|\b2\d\d\b)\b/i.test(s)) return "info";
  return null;
}

// Log body styling: bolder, glowing, level-coloured text (echoing the replay look) and
// a slide-in transition for freshly-arrived lines. A subtle edge glow while streaming.
const DLOG_CSS = `
.rcw-dlog { font-family: var(--font-mono); font-size: 10.6px; line-height: 1.55; transition: box-shadow .3s; }
.rcw-dlog.streaming { box-shadow: inset 0 0 22px -8px rgb(var(--primary-soft) / 0.35), inset 0 2px 0 -1px rgb(var(--accent) / 0.4); }
.rcw-dlog-line { white-space: pre-wrap; word-break: break-word; font-weight: 500; color: var(--text);
  text-shadow: 0 0 3px rgb(var(--primary-soft) / 0.28); }
.rcw-dlog-line.in { animation: rcw-dlog-in .26s cubic-bezier(.2,.8,.2,1) both; }
@keyframes rcw-dlog-in { from { opacity: 0; transform: translateX(-9px); filter: brightness(1.9); } to { opacity: 1; transform: none; filter: none; } }
.rcw-dlog-line.lvl-err  { color: #ff8f85; text-shadow: 0 0 5px rgb(255 107 107 / 0.45); }
.rcw-dlog-line.lvl-warn { color: #ffcf7a; text-shadow: 0 0 5px rgb(255 178 84 / 0.4); }
.rcw-dlog-line.lvl-info { color: #7ff0c0; text-shadow: 0 0 4px rgb(94 242 176 / 0.35); }
.rcw-dlog-line.lvl-debug { color: var(--text-faint); text-shadow: none; font-weight: 400; }
.rcw-dlog-rx { display: inline-flex; align-items: flex-end; gap: 1px; height: 12px; }
.rcw-dlog-rx > i { width: 2px; background: rgb(var(--accent)); border-radius: 1px; box-shadow: 0 0 4px rgb(var(--accent) / 0.7); transition: height .25s ease; }
`;

/** A live "receiving" bar-meter that spikes with the incoming log line-rate. */
function StreamMeter({ rate }: { rate: number[] }) {
  const bars = rate.slice(-14);
  const peak = Math.max(2, ...bars);
  const lps = Math.round((bars.slice(-3).reduce((a, b) => a + b, 0) / 3) * 2.5);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }} title="incoming log rate">
      <span className="rcw-dlog-rx">
        {bars.map((v, i) => <i key={i} style={{ height: `${Math.max(2, (v / peak) * 12)}px`, opacity: 0.5 + 0.5 * (i / bars.length) }} />)}
      </span>
      <span className="mono" style={{ fontSize: 9, color: "rgb(var(--accent))", letterSpacing: "0.04em" }}>{lps}/s</span>
    </span>
  );
}

const shortName = (n: string): string => n.replace(/^\//, "");

// Persisted per-(session, window) container selection, so a Docker Log window
// reopens showing the same container across session switches and app restarts.
const SEL_KEY = "rcw.dockerlog.selection";
function loadSelection(key: string): string {
  try { return (JSON.parse(localStorage.getItem(SEL_KEY) || "{}") as Record<string, string>)[key] ?? ""; }
  catch { return ""; }
}
function saveSelection(key: string, value: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(SEL_KEY) || "{}") as Record<string, string>;
    all[key] = value;
    localStorage.setItem(SEL_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

const fmtBytes = (b: number | null): string => {
  if (!b || b <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i <= 1 ? 0 : 1)}${u[i]}`;
};

const pct = (n: number | null): string => (n == null ? "—" : `${n < 10 ? n.toFixed(1) : n.toFixed(0)}%`);

/** A small glowing sparkline, auto-scaled to its own peak so small-but-nonzero
 * usage (e.g. a container idling at ~2% CPU) is still visible and moves, rather
 * than looking pinned to 0 on a fixed 0–100 axis. */
function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const W = 100, H = 30;
  const peak = Math.max(1, ...data);
  const pts = data.length < 2 ? [] : data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (Math.max(0, Math.min(peak, v)) / peak) * (H - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block", filter: `drop-shadow(0 0 5px ${color})` }}>
      {pts.length > 0 && (
        <>
          <polyline points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={color} opacity={0.12} stroke="none" />
          <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

/**
 * Live Docker log viewer for the focused session's host. Pick any container from
 * the host's list and its `docker logs -f` output streams here (tailing the last
 * 300 lines). Only streams while `active` (its window is open) to avoid spending an
 * SSH connection on a minimized/hidden window. `streamId` is the owning window's id
 * so several Docker Log windows can each tail a different container at once.
 */
export default function DockerLogPanel({ streamId, active }: { streamId: string; active: boolean }) {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const machine = session?.machine ?? null;

  // Remember the picked container per (session, window) so it survives switching
  // sessions, closing/reopening the window, and app restarts.
  const selKey = `${focusId ?? "none"}:${streamId}`;
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [container, setContainer] = useState(() => loadSelection(selKey));
  // Log rendered as individual lines (stable ids) so freshly-arrived lines can animate
  // in and only NEW lines re-render. `text` is derived for find + the replay stream.
  const [lines, setLines] = useState<LogLine[]>([]);
  const text = useMemo(() => lines.map((l) => l.text).join("\n"), [lines]);
  const leftoverRef = useRef("");   // trailing partial line (no \n yet) held for next flush
  const nextIdRef = useRef(0);
  const streamStartRef = useRef(0); // lines within ~600ms of (re)start are the scrollback → no entrance anim
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  const bufRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Replay gating: `busy` while log lines are actively arriving, `scrolling`/`atBottom`
  // while the user is reading. Any of these suppresses / cancels the transmission replay.
  const [busy, setBusy] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live line-rate for the "receiving" meter: count newlines between samples.
  const linesRef = useRef(0);
  const [rate, setRate] = useState<number[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const n = linesRef.current; linesRef.current = 0;
      setRate((r) => (n === 0 && r.every((v) => v === 0) ? r : [...r, n].slice(-26)));
    }, 400);
    return () => clearInterval(id);
  }, []);
  const [retryNonce, setRetryNonce] = useState(0); // bumped to re-attach after the stream ends
  const containerRef = useRef(container);
  containerRef.current = container;

  // In-log find.
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const finding = findOpen && find.length > 0;

  // Container list for the focused host — mirrors DockerDeck's per-host filter.
  useEffect(() => {
    if (!machine) { setContainers([]); return; }
    let alive = true;
    const load = () =>
      window.cowork
        .getDocker()
        .then((hosts) => {
          if (!alive) return;
          const host = bestDockerHost(hosts as DockerHostView[], machine);
          setContainers(host?.available ? host.containers : []);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [machine]);

  // Load this (session, window)'s remembered container when the key changes.
  useEffect(() => { setContainer(loadSelection(selKey)); }, [selKey]);

  // Persist the picked container so it's restored on reopen / restart.
  useEffect(() => { if (container) saveSelection(selKey, container); }, [selKey, container]);

  // Auto-pick the first running container (else the first) ONLY when there's no
  // current selection at all. A remembered/user-picked container is sticky: we must
  // never override it just because it's momentarily absent from the list — on restart
  // the host is still connecting and the poll is empty/partial, and a stopped
  // container is filtered out. Overriding here would persist the fallback over the
  // user's choice (see the save effect above) and lose it permanently across restarts.
  useEffect(() => {
    if (container) return; // keep any existing selection (remembered or user-picked)
    if (containers.length === 0) return; // nothing to pick from yet
    const first = containers.find((c) => c.state === "running") ?? containers[0];
    setContainer(first ? shortName(first.name) : "");
  }, [containers, container]);

  // Status history for the selected container: reset on switch, then append one
  // CPU/MEM sample per poll (containers refresh) for the live sparklines.
  useEffect(() => { setHistory({ cpu: [], mem: [] }); }, [container, machine]);
  useEffect(() => {
    const c = containers.find((x) => shortName(x.name) === containerRef.current);
    if (!c) return;
    setHistory((h) => ({
      cpu: [...h.cpu, Math.max(0, c.cpuPct ?? 0)].slice(-HIST),
      mem: [...h.mem, Math.max(0, c.memPct ?? 0)].slice(-HIST),
    }));
  }, [containers]);

  // Coalesce incoming chunks: buffer in a ref, flush a few times a second (so a
  // high-volume log doesn't render per chunk), splitting into complete lines. Lines
  // arriving after the initial scrollback settles are marked `anim` → they slide in.
  useEffect(() => {
    const t = setInterval(() => {
      if (!bufRef.current) return;
      const chunk = bufRef.current;
      bufRef.current = "";
      const pending = leftoverRef.current + chunk;
      const parts = pending.split("\n");
      leftoverRef.current = parts.pop() ?? ""; // last piece has no trailing \n yet
      if (parts.length === 0) return;
      const anim = Date.now() - streamStartRef.current > 600;
      setLines((prev) => {
        const add: LogLine[] = parts.map((tx) => ({ id: nextIdRef.current++, text: tx, anim, lvl: levelOf(tx) }));
        const next = prev.concat(add);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    }, 150);
    return () => clearInterval(t);
  }, []);

  // Stream lifecycle — (re)start whenever the window becomes active or the target
  // container/host changes. Tearing down stops the underlying ssh process. When the
  // stream ends on its own (e.g. the container is restarted mid-dev), auto-retry
  // after 30s by bumping `retryNonce`; a container/host switch resets the log while
  // a retry keeps the accumulated output so the reconnect reads as continuous.
  const isRetry = retryNonce > 0;
  useEffect(() => {
    if (!active || !machine || !container) return;
    // The scrollback that loads now shouldn't animate line-by-line — only live lines do.
    streamStartRef.current = Date.now();
    if (!isRetry) { setLines([]); leftoverRef.current = ""; bufRef.current = ""; }
    stick.current = true;
    const armRetry = () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setRetryNonce((n) => n + 1), RETRY_MS);
    };
    const offData = window.cowork.onDockerLogData((a) => {
      if (a.id !== streamId) return;
      bufRef.current += a.data;
      const nl = a.data.split("\n").length - 1;
      if (nl > 0) { playSfx("output"); linesRef.current += nl; } // output cue + line-rate meter
      // Mark the stream busy for a few seconds so a replay won't fire over live logs.
      setBusy(true);
      if (busyTimer.current) clearTimeout(busyTimer.current);
      busyTimer.current = setTimeout(() => setBusy(false), 4000);
    });
    const offExit = window.cowork.onDockerLogExit((a) => {
      if (a.id !== streamId) return;
      bufRef.current += `\n[stream ended — reconnecting in ${RETRY_MS / 1000}s]\n`;
      armRetry();
    });
    let cancelled = false;
    window.cowork
      .startDockerLog({ id: streamId, machine, container })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) { if (r.replay) bufRef.current += r.replay; }
        else { bufRef.current += `\n[error] ${r.error} — reconnecting in ${RETRY_MS / 1000}s\n`; armRetry(); }
      })
      .catch((e) => { if (!cancelled) { bufRef.current += `\n[error] ${String(e)} — reconnecting in ${RETRY_MS / 1000}s\n`; armRetry(); } });
    return () => {
      cancelled = true;
      offData();
      offExit();
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      window.cowork.stopDockerLog(streamId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, machine, container, retryNonce]);

  // Cancel any pending retry when the target changes (a fresh stream is starting).
  useEffect(() => { setRetryNonce(0); }, [active, machine, container]);

  // Tail: keep pinned to the bottom unless the user scrolled up (or is searching).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current && !finding) el.scrollTop = el.scrollHeight;
  }, [lines, finding]);

  // Scroll handler: track whether we're at the bottom, and if the user scrolled up,
  // arm a 1-minute idle timer that resumes tailing (reset on every scroll).
  const onLogScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = bottom;
    setAtBottom(bottom);
    // User is reading → suppress the replay (active scroll + a short cooldown).
    setScrolling(true);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setScrolling(false), 2500);
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    if (!bottom && !finding) {
      idleTimer.current = setTimeout(() => {
        stick.current = true;
        setAtBottom(true);
        const e2 = scrollRef.current;
        if (e2) e2.scrollTop = e2.scrollHeight;
      }, IDLE_RETURN_MS);
    }
  };
  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (busyTimer.current) clearTimeout(busyTimer.current);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, []);

  // Recent log lines → the replay stream (a snapshot is captured when a replay fires).
  const relayItems = useMemo<RelayItem[]>(() => {
    const recent = lines.filter((l) => l.text.trim().length > 0).slice(-RELAY_COUNT);
    return recent.map((l) => ({ key: `${container}-${l.id}`, label: "LOG", icon: "❯", color: "rgb(var(--primary-soft))", detail: l.text.replace(/\s+$/, "").slice(0, 400) }));
  }, [lines, container]);
  const relay = useRelay(relayItems, active && !!container && !finding, busy || scrolling || !atBottom);

  // Find: rendered nodes + match count, reset to first match as the query changes,
  // and scroll the active match into view when navigating (not while streaming).
  const highlighted = useMemo(() => (finding ? highlight(text, find, matchIdx) : null), [finding, text, find, matchIdx]);
  const matchCount = highlighted?.count ?? 0;
  useEffect(() => { setMatchIdx(0); }, [find]);
  useEffect(() => { if (matchIdx >= matchCount) setMatchIdx(matchCount > 0 ? matchCount - 1 : 0); }, [matchCount, matchIdx]);
  useEffect(() => {
    if (!finding) return;
    const t = setTimeout(() => {
      (scrollRef.current?.querySelector(`[data-mi="${matchIdx}"]`) as HTMLElement | null)?.scrollIntoView({ block: "center" });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIdx, find, findOpen]);
  const gotoMatch = (dir: 1 | -1) => { if (matchCount > 0) setMatchIdx((i) => (i + dir + matchCount) % matchCount); };

  const sel = containers.find((c) => shortName(c.name) === container) ?? null;
  const running = sel?.state === "running";

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <RelayStyles />
      <style>{DLOG_CSS}</style>
      {/* control row: container picker + live indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 13 }}>🐳</span>
        {machine ? (
          containers.length > 0 ? (
            <ContainerPicker containers={containers} value={container} onChange={setContainer} />
          ) : (
            <span className="mono faint" style={{ fontSize: 11, flex: 1 }}>no containers on {machine}</span>
          )
        ) : (
          <span className="mono faint" style={{ fontSize: 11, flex: 1 }}>select a session</span>
        )}
        {container && busy && <StreamMeter rate={rate} />}
        {container && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <span
              style={{ width: 6, height: 6, borderRadius: 999, background: running ? "rgb(var(--accent))" : "var(--border-strong)" }}
              className={running ? "hud-pulse" : undefined}
            />
            <span className="mono faint" style={{ fontSize: 9.5 }}>-f</span>
          </span>
        )}
        {!relay.playing && relayItems.length > 0 && !busy && atBottom && (
          <span className="mono faint" style={{ fontSize: 9, letterSpacing: "0.1em", flexShrink: 0 }} title="Next transmission replay">◈ {relay.secs}s</span>
        )}
        <button onClick={() => setFindOpen((v) => !v)} title="Find in log"
          style={{ ...findBtn, flexShrink: 0, background: findOpen ? "rgb(var(--primary) / 0.22)" : "transparent", color: findOpen ? "var(--text)" : "var(--text-soft)" }}>⌕</button>
      </div>

      {/* find bar */}
      {findOpen && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderBottom: "1px solid var(--border)", background: "rgb(var(--primary) / 0.04)", flexShrink: 0 }}>
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
              if (e.key === "Escape") { setFindOpen(false); setFind(""); }
            }}
            placeholder="Find in log…"
            className="mono"
            style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 7, padding: "4px 8px", fontSize: 11.5, color: "var(--text)", outline: "none" }}
          />
          <span className="mono faint" style={{ fontSize: 10, minWidth: 42, textAlign: "right" }}>
            {matchCount ? `${matchIdx + 1}/${matchCount}` : find ? "0/0" : ""}
          </span>
          <button onClick={() => gotoMatch(-1)} disabled={!matchCount} title="Previous (⇧⏎)" style={findBtn}>▲</button>
          <button onClick={() => gotoMatch(1)} disabled={!matchCount} title="Next (⏎)" style={findBtn}>▼</button>
          <button onClick={() => { setFindOpen(false); setFind(""); }} title="Close (Esc)" style={findBtn}>✕</button>
        </div>
      )}

      {/* futuristic status graph for the selected container */}
      {sel && (
        <div style={{ display: "flex", gap: 12, padding: "9px 12px", borderBottom: "1px solid var(--border)", background: "rgb(var(--primary) / 0.03)", flexShrink: 0, position: "relative" }}>
          <span className="hud-corner" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase" }}>CPU</span>
              <span className="mono" style={{ fontSize: 10.5, color: "rgb(var(--primary-soft))" }}>{pct(sel.cpuPct)}</span>
            </div>
            <MiniSpark data={history.cpu} color="rgb(var(--primary-soft))" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase" }}>MEM</span>
              <span className="mono" style={{ fontSize: 10.5, color: "rgb(var(--accent))" }}>
                {fmtBytes(sel.memUsed)}{sel.memPct != null ? ` · ${pct(sel.memPct)}` : ""}
              </span>
            </div>
            <MiniSpark data={history.mem} color="rgb(var(--accent))" />
          </div>
        </div>
      )}

      {/* log body — per-line so fresh lines slide in; bold, level-coloured, glowing */}
      <div ref={scrollRef} className={`rcw-dlog no-scrollbar${busy ? " streaming" : ""}`} onScroll={onLogScroll}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px" }}>
        {finding ? (
          <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: 1.55, color: "var(--text-soft)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{highlighted?.nodes}</pre>
        ) : lines.length ? (
          lines.map((l) => (
            <div key={l.id} className={`rcw-dlog-line${l.anim ? " in" : ""}${l.lvl ? ` lvl-${l.lvl}` : ""}`}>{l.text || " "}</div>
          ))
        ) : (
          <span className="mono faint hud-blink" style={{ fontSize: 10.5 }}>
            {machine && container ? "attaching to log stream…" : "no container selected"}
          </span>
        )}
      </div>
      {relay.playing && <RelayOverlay queue={relay.queue} idx={relay.idx} title="Log replay" onDismiss={relay.dismiss} />}
    </div>
  );
}

const findBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 6, padding: "2px 7px", fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer", lineHeight: 1.4,
};

/** Searchable container picker: a button that opens a filterable list — so a host
 * with many containers stays easy to search rather than scrolling a long <select>. */
function ContainerPicker({ containers, value, onChange }: { containers: DockerContainer[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const s = q.trim().toLowerCase();
  const filtered = s
    ? containers.filter((c) => shortName(c.name).toLowerCase().includes(s) || (c.state ?? "").toLowerCase().includes(s))
    : containers;
  const cur = containers.find((c) => shortName(c.name) === value) ?? null;
  return (
    <div ref={boxRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button
        onClick={() => { setOpen((o) => !o); setQ(""); }}
        className="mono"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, background: "rgb(var(--primary) / 0.06)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", fontSize: 11.5, outline: "none", cursor: "pointer" }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
          {cur ? `${shortName(cur.name)} · ${cur.state}` : value || "select container"}
        </span>
        <span className="faint" style={{ fontSize: 9, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div className="hud-window" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, borderRadius: 10, border: "1px solid var(--border-strong)", boxShadow: "0 12px 40px rgb(0 0 0 / 0.5)", background: "var(--app-panel)", padding: 6 }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); }
              if (e.key === "Enter" && filtered.length) { onChange(shortName(filtered[0].name)); setOpen(false); }
            }}
            placeholder="Search containers…"
            className="mono"
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 11.5, color: "var(--text)", outline: "none", marginBottom: 6 }}
          />
          <div className="no-scrollbar" style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {filtered.length === 0 ? (
              <div className="mono faint" style={{ fontSize: 10.5, padding: "4px 6px" }}>no match</div>
            ) : filtered.map((c) => {
              const name = shortName(c.name);
              const on = name === value;
              const run = c.state === "running";
              return (
                <div key={c.id || c.name} onClick={() => { onChange(name); setOpen(false); }} className="hud-rail-row"
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 7, cursor: "pointer", background: on ? "rgb(var(--primary) / 0.18)" : "transparent" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: run ? "rgb(var(--accent))" : "var(--border-strong)", flexShrink: 0 }} />
                  <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <span className="mono faint" style={{ fontSize: 9, flexShrink: 0 }}>{c.state}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
