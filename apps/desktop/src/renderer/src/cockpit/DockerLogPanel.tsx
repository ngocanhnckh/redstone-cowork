import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { DockerContainer, DockerHostView } from "../types";

const MAX_CHARS = 200_000; // trim the rendered buffer so a chatty container can't grow unbounded
const HIST = 48; // samples kept for the status sparklines (~4 min at the 5s poll)

const shortName = (n: string): string => n.replace(/^\//, "");

const fmtBytes = (b: number | null): string => {
  if (!b || b <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i <= 1 ? 0 : 1)}${u[i]}`;
};

/** A small glowing 0–100% sparkline for the container status readout. */
function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const W = 100, H = 30;
  const pts = data.length < 2 ? [] : data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (Math.max(0, Math.min(100, v)) / 100) * (H - 3) - 1.5;
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

  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [container, setContainer] = useState("");
  const [text, setText] = useState("");
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  const bufRef = useRef("");
  const preRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const containerRef = useRef(container);
  containerRef.current = container;

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

  // Reset the selection when the host changes; the effect below re-picks a default.
  useEffect(() => { setContainer(""); }, [machine]);

  // Auto-pick the first running container (else the first) when nothing valid is chosen.
  useEffect(() => {
    if (container && containers.some((c) => shortName(c.name) === container)) return;
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
  // container/host changes. Tearing down stops the underlying ssh process.
  useEffect(() => {
    if (!active || !machine || !container) return;
    setText("");
    bufRef.current = "";
    stick.current = true;
    const offData = window.cowork.onDockerLogData((a) => { if (a.id === streamId) bufRef.current += a.data; });
    const offExit = window.cowork.onDockerLogExit((a) => { if (a.id === streamId) bufRef.current += "\n[stream ended]\n"; });
    let cancelled = false;
    window.cowork
      .startDockerLog({ id: streamId, machine, container })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) { if (r.replay) bufRef.current += r.replay; }
        else bufRef.current += `\n[error] ${r.error}\n`;
      })
      .catch((e) => { if (!cancelled) bufRef.current += `\n[error] ${String(e)}\n`; });
    return () => {
      cancelled = true;
      offData();
      offExit();
      window.cowork.stopDockerLog(streamId);
    };
  }, [active, machine, container]);

  // Keep pinned to the bottom unless the user scrolled up.
  useEffect(() => {
    const el = preRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);

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
      </div>

      {/* futuristic status graph for the selected container */}
      {sel && (
        <div style={{ display: "flex", gap: 12, padding: "9px 12px", borderBottom: "1px solid var(--border)", background: "rgb(var(--primary) / 0.03)", flexShrink: 0, position: "relative" }}>
          <span className="hud-corner" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase" }}>CPU</span>
              <span className="mono" style={{ fontSize: 10.5, color: "rgb(var(--primary-soft))" }}>{sel.cpuPct != null ? `${sel.cpuPct.toFixed(0)}%` : "—"}</span>
            </div>
            <MiniSpark data={history.cpu} color="rgb(var(--primary-soft))" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase" }}>MEM</span>
              <span className="mono" style={{ fontSize: 10.5, color: "rgb(var(--accent))" }}>
                {fmtBytes(sel.memUsed)}{sel.memPct != null ? ` · ${sel.memPct.toFixed(0)}%` : ""}
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
        onScroll={() => { const el = preRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        style={{
          flex: 1, minHeight: 0, overflowY: "auto", margin: 0, padding: "10px 12px",
          fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: 1.5, color: "var(--text-soft)",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}
      >
        {text || (
          <span className="mono faint hud-blink">
            {machine && container ? "attaching to log stream…" : "no container selected"}
          </span>
        )}
      </pre>
    </div>
  );
}
