import { useState, useEffect } from "react";
import { useStore } from "../store";
import { SessionView } from "../types";

function initials(cwd: string): string {
  const base = cwd.split("/").filter(Boolean).pop() ?? "??";
  const words = base.split(/[-_]/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

function ago(since: string | null | undefined): string {
  if (!since) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// The genuine "needs your answer" decisions (passive completion/notification cards
// do NOT make a session waiting — that was the bug that showed everything waiting).
const ACTIONABLE = new Set(["question", "permission"]);

// Manual drag order (session ids). When set, it takes precedence over the status
// sort; sessions not in the list fall back to status order after the ordered ones.
const ORDER_KEY = "rcw.hud.sessionOrder";
function loadOrder(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]");
    return Array.isArray(r) ? r.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type Kind = "waiting" | "working" | "active" | "idle" | "lost";
const META: Record<Kind, { label: string; color: string; pulse: boolean }> = {
  waiting: { label: "waiting for you", color: "rgb(var(--accent))", pulse: true },
  working: { label: "working…", color: "rgb(var(--primary-soft))", pulse: true },
  active: { label: "online", color: "rgb(var(--primary-soft))", pulse: false },
  idle: { label: "idle", color: "var(--border-strong)", pulse: false },
  lost: { label: "offline", color: "var(--border-strong)", pulse: false },
};

export default function QueueRail() {
  const [, tick] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const saveOrder = (o: string[]) => {
    setOrder(o);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch { /* ignore */ }
  };
  const orderPos = (id: string): number => {
    const i = order.indexOf(id);
    return i === -1 ? Infinity : i;
  };

  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);
  const focusId = useStore((s) => s.focusId);
  const setFocus = useStore((s) => s.setFocus);
  const dismissSession = useStore((s) => s.dismissSession);
  const pendingMap = useStore((s) => s.pending);

  const needsInput = new Set(decisions.filter((d) => ACTIONABLE.has(d.kind)).map((d) => d.sessionId));
  const waitingSince = new Map(queue.map((q) => [q.id, q.waitingSince] as const));

  const kindOf = (s: SessionView): Kind => {
    if (s.status === "lost") return "lost";
    if (needsInput.has(s.id)) return "waiting";
    // Busy if the server says so, OR we have an optimistic send not yet echoed —
    // so the "working" animation appears the instant you send, with no gap.
    if (s.working || (pendingMap[s.id]?.length ?? 0) > 0) return "working";
    if (s.status === "stale") return "idle";
    return "active";
  };
  const rank: Record<Kind, number> = { waiting: 0, working: 1, active: 2, idle: 3, lost: 4 };

  const rows = [...sessions]
    .map((s) => ({ s, kind: kindOf(s) }))
    .filter((r) => r.kind !== "lost") // hide offline sessions from the rail
    .sort((a, b) => {
      // Manual drag order wins; sessions not yet ordered fall back to status order.
      const pa = orderPos(a.s.id), pb = orderPos(b.s.id);
      if (pa !== pb) return pa - pb;
      if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
      // Within "waiting", longest-waiting first.
      const aw = waitingSince.get(a.s.id) ? new Date(waitingSince.get(a.s.id)!).getTime() : Infinity;
      const bw = waitingSince.get(b.s.id) ? new Date(waitingSince.get(b.s.id)!).getTime() : Infinity;
      return aw - bw;
    });

  const waitingCount = rows.filter((r) => r.kind === "waiting").length;

  // Drag to reorder. On drag start, snapshot the full visible order (preserving any
  // existing manual order, dropping gone sessions, appending new ones) so dragging
  // can reposition everything; on hover over another row, splice the dragged id in.
  const onRowDragStart = (id: string) => {
    const visible = rows.map((r) => r.s.id);
    const merged = [...order.filter((x) => visible.includes(x)), ...visible.filter((x) => !order.includes(x))];
    if (merged.join("|") !== order.join("|")) saveOrder(merged);
    setDragId(id);
  };
  const onRowDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setOverId(targetId);
    if (!dragId || dragId === targetId) return;
    const list = (order.length ? order : rows.map((r) => r.s.id)).slice();
    const from = list.indexOf(dragId), to = list.indexOf(targetId);
    if (from === -1 || to === -1 || from === to) return;
    list.splice(from, 1);
    list.splice(to, 0, dragId);
    saveOrder(list);
  };
  const onRowDragEnd = () => { setDragId(null); setOverId(null); };

  return (
    <div style={{ padding: "18px 14px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 7, overflowY: "auto" }}>
      <div className="hud-chip" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="kicker">Sessions</span>
        <span className="mono faint" style={{ fontSize: 11 }}>
          {waitingCount > 0 ? `${waitingCount} waiting` : `${rows.length}`}
        </span>
      </div>

      {rows.length === 0 && <span className="mono faint" style={{ fontSize: 11, padding: "6px 4px" }}>no sessions</span>}

      {rows.map(({ s: session, kind }) => {
        const focused = session.id === focusId;
        const meta = META[kind];
        const detail = kind === "waiting" ? `waiting ${ago(waitingSince.get(session.id)) || ago(session.lastSeenAt)}` : meta.label;
        return (
          <div
            key={session.id}
            className={focused ? "glass-inset" : "glass-inset glass-inset-hover"}
            draggable
            onClick={() => setFocus(session.id)}
            onMouseEnter={() => setHoverId(session.id)}
            onMouseLeave={() => setHoverId((h) => (h === session.id ? null : h))}
            onDragStart={() => onRowDragStart(session.id)}
            onDragOver={(e) => onRowDragOver(e, session.id)}
            onDrop={(e) => { e.preventDefault(); onRowDragEnd(); }}
            onDragEnd={onRowDragEnd}
            style={{
              display: "flex", gap: 11, alignItems: "center", padding: "11px 12px", borderRadius: 13,
              cursor: "pointer", position: "relative", width: "100%",
              opacity: dragId === session.id ? 0.4 : kind === "lost" ? 0.55 : 1,
              background: focused ? `rgba(var(--primary), 0.12)` : undefined,
              borderLeft: focused ? `3px solid rgb(var(--primary-soft))` : undefined,
              boxShadow: overId === session.id && dragId && dragId !== session.id ? "inset 0 2px 0 rgb(var(--accent))" : undefined,
            }}
          >
            {focused && (
              <span style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 9, background: `linear-gradient(rgb(var(--primary-soft)), rgb(var(--accent)))` }} />
            )}
            <span style={{ position: "relative", flexShrink: 0 }}>
              <span
                style={{
                  width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center",
                  fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12,
                  background: focused ? `rgb(var(--primary) / 0.3)` : `rgb(var(--accent) / 0.22)`,
                  color: focused ? undefined : `rgb(var(--accent))`,
                }}
              >
                {initials(session.cwd)}
              </span>
              {/* status dot — the actual per-session state */}
              <span
                title={meta.label}
                style={{
                  position: "absolute", right: -2, bottom: -2, width: 10, height: 10, borderRadius: 999,
                  background: meta.color, border: "2px solid var(--app-panel, #1b1712)",
                  animation: meta.pulse ? "pulse 2s infinite" : undefined,
                }}
              />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {projectName(session.cwd)}
              </div>
              <div className="mono faint" style={{ fontSize: 10.5, color: kind === "waiting" ? "rgb(var(--accent))" : undefined }}>
                {detail}
              </div>
            </div>
            {/* Persistent "working" loader so you always know which session is busy
                (previously hidden on hover, which read as it disappearing). */}
            {kind === "working" && (
              <span className="eq" style={{ flexShrink: 0 }} title="working…">
                {[0, 1, 2].map((i) => <span key={i} className="eq-bar" style={{ animationDelay: `${i * 0.13}s` }} />)}
              </span>
            )}
            {/* Drag-to-reorder hint — reserves its slot so nothing shifts on hover. */}
            <span
              title="Drag to reorder"
              style={{
                flexShrink: 0, width: 11, textAlign: "center", cursor: "grab", fontSize: 13, lineHeight: 1,
                color: "var(--border-strong)", opacity: hoverId === session.id ? 0.7 : 0, transition: "opacity 120ms",
              }}
            >
              ⠿
            </span>
            {/* Dismiss (soft-close) — revealed on hover; small + stopPropagation so it
                never selects the card. Muted, red-ish on hover to match the HUD. */}
            <button
              title="Dismiss session"
              aria-label="Dismiss session"
              onClick={(e) => {
                e.stopPropagation();
                dismissSession(session.id);
              }}
              style={{
                flexShrink: 0, width: 18, height: 18, borderRadius: 6, padding: 0,
                display: "grid", placeItems: "center", cursor: "pointer",
                border: "none", background: "transparent", lineHeight: 1, fontSize: 13,
                color: "var(--border-strong)",
                opacity: hoverId === session.id ? 0.85 : 0,
                transition: "opacity 120ms, color 120ms",
                pointerEvents: hoverId === session.id ? "auto" : "none",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#e0736a"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--border-strong)"; }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
