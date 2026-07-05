import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { DockerContainer, DockerHostView } from "../types";

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

const MAX_CHARS = 200_000; // trim the rendered buffer so a chatty container can't grow unbounded
const HIST = 48; // samples kept for the status sparklines (~4 min at the 5s poll)

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
  const [text, setText] = useState("");
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  const bufRef = useRef("");
  const preRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          const host = (hosts as DockerHostView[]).find((h) => h.machine === machine);
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

  // Auto-pick the first running container (else the first) only when the current
  // selection is empty or no longer present (a remembered one that still exists wins).
  useEffect(() => {
    if (container && containers.some((c) => shortName(c.name) === container)) return;
    if (containers.length === 0) return; // keep the remembered name until the list loads
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

  // Coalesce incoming chunks: buffer in a ref, flush to state a few times a second
  // so a high-volume log doesn't trigger a render per chunk.
  useEffect(() => {
    const t = setInterval(() => {
      if (!bufRef.current) return;
      const chunk = bufRef.current;
      bufRef.current = "";
      setText((prev) => {
        const next = prev + chunk;
        return next.length > MAX_CHARS ? next.slice(next.length - MAX_CHARS) : next;
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
    if (!isRetry) { setText(""); bufRef.current = ""; }
    stick.current = true;
    const armRetry = () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setRetryNonce((n) => n + 1), RETRY_MS);
    };
    const offData = window.cowork.onDockerLogData((a) => { if (a.id === streamId) bufRef.current += a.data; });
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
    const el = preRef.current;
    if (el && stick.current && !finding) el.scrollTop = el.scrollHeight;
  }, [text, finding]);

  // Scroll handler: track whether we're at the bottom, and if the user scrolled up,
  // arm a 1-minute idle timer that resumes tailing (reset on every scroll).
  const onLogScroll = () => {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = atBottom;
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    if (!atBottom && !finding) {
      idleTimer.current = setTimeout(() => {
        stick.current = true;
        const e2 = preRef.current;
        if (e2) e2.scrollTop = e2.scrollHeight;
      }, IDLE_RETURN_MS);
    }
  };
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current); }, []);

  // Find: rendered nodes + match count, reset to first match as the query changes,
  // and scroll the active match into view when navigating (not while streaming).
  const highlighted = useMemo(() => (finding ? highlight(text, find, matchIdx) : null), [finding, text, find, matchIdx]);
  const matchCount = highlighted?.count ?? 0;
  useEffect(() => { setMatchIdx(0); }, [find]);
  useEffect(() => { if (matchIdx >= matchCount) setMatchIdx(matchCount > 0 ? matchCount - 1 : 0); }, [matchCount, matchIdx]);
  useEffect(() => {
    if (!finding) return;
    const t = setTimeout(() => {
      (preRef.current?.querySelector(`[data-mi="${matchIdx}"]`) as HTMLElement | null)?.scrollIntoView({ block: "center" });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIdx, find, findOpen]);
  const gotoMatch = (dir: 1 | -1) => { if (matchCount > 0) setMatchIdx((i) => (i + dir + matchCount) % matchCount); };

  const sel = containers.find((c) => shortName(c.name) === container) ?? null;
  const running = sel?.state === "running";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* control row: container picker + live indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 13 }}>🐳</span>
        {machine ? (
          containers.length > 0 ? (
            <select
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              className="mono"
              style={{
                flex: 1, minWidth: 0, background: "rgb(var(--primary) / 0.06)", color: "var(--text)",
                border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", fontSize: 11.5, outline: "none", cursor: "pointer",
              }}
            >
              {containers.map((c) => (
                <option key={c.id || c.name} value={shortName(c.name)}>
                  {shortName(c.name)} · {c.state}
                </option>
              ))}
            </select>
          ) : (
            <span className="mono faint" style={{ fontSize: 11, flex: 1 }}>no containers on {machine}</span>
          )
        ) : (
          <span className="mono faint" style={{ fontSize: 11, flex: 1 }}>select a session</span>
        )}
        {container && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <span
              style={{ width: 6, height: 6, borderRadius: 999, background: running ? "rgb(var(--accent))" : "var(--border-strong)" }}
              className={running ? "hud-pulse" : undefined}
            />
            <span className="mono faint" style={{ fontSize: 9.5 }}>-f</span>
          </span>
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

      {/* log body */}
      <pre
        ref={preRef}
        className="no-scrollbar"
        onScroll={onLogScroll}
        style={{
          flex: 1, minHeight: 0, overflowY: "auto", margin: 0, padding: "10px 12px",
          fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: 1.5, color: "var(--text-soft)",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}
      >
        {finding ? highlighted?.nodes : text || (
          <span className="mono faint hud-blink">
            {machine && container ? "attaching to log stream…" : "no container selected"}
          </span>
        )}
      </pre>
    </div>
  );
}

const findBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 6, padding: "2px 7px", fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer", lineHeight: 1.4,
};
