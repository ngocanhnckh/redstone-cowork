"use client";
import { useCallback, useEffect, useState } from "react";
import { DecisionCard, type Decision } from "../components/DecisionCard";
import { SessionRow } from "../components/SessionRow";
import { NotificationsToggle } from "../components/NotificationsToggle";
import { Connections } from "../components/Connections";
import { Devices } from "../components/Devices";

type Session = {
  id: string;
  machine: string;
  cwd: string;
  status: string;
  pendingDecisions: number;
  wrapperId?: string | null;
  permissionMode?: string | null;
  autoModeEnabled?: boolean;
};

// Actionable decisions (a question, a permission) surface before passive ones
// (notifications, completions). Within each, oldest first so nothing gets buried.
const PRIORITY: Record<string, number> = { question: 0, permission: 0 };
function queueOrder(a: Decision, b: Decision): number {
  const pa = PRIORITY[a.kind] ?? 1;
  const pb = PRIORITY[b.kind] ?? 1;
  if (pa !== pb) return pa - pb;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

const STATUS_DOT: Record<string, string> = {
  active: "rgb(var(--primary-soft))",
  waiting: "rgb(var(--accent))",
  stale: "var(--text-faint)",
  lost: "#e0736a",
};

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetch("/api/proxy/sessions"),
        fetch("/api/proxy/decisions?status=pending"),
      ]);
      if (s.status === 401 || d.status === 401) {
        window.location.href = "/login";
        return;
      }
      setSessions(await s.json());
      setDecisions(await d.json());
    } catch {
      // ignore errors, keep last good state
    }
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource("/api/stream");
    es.onmessage = () => refresh();
    const poll = setInterval(refresh, 30_000); // safety net
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [refresh]);

  const queue = [...decisions].sort(queueOrder);
  const current = queue[0];
  const waiting = sessions.filter((s) => s.status === "waiting").length;
  const live = sessions.filter((s) => s.status === "active").length;

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "40px 22px 80px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="kicker">Redstone Cowork</span>
        <span style={{ flex: 1 }} />
        <NotificationsToggle />
      </div>
      <h1 className="display" style={{ fontSize: 46, margin: "0 0 4px" }}>Cockpit</h1>
      <p className="soft" style={{ fontSize: 13.5, margin: "0 0 30px" }}>
        {sessions.length
          ? `${sessions.length} session${sessions.length > 1 ? "s" : ""}${live ? ` · ${live} active` : ""}${waiting ? ` · ${waiting} waiting on you` : ""}`
          : "No sessions attached yet."}
      </p>

      {/* Needs you */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span className="kicker" style={{ color: "rgb(var(--accent))" }}>Needs you</span>
        {queue.length > 0 && <span className="faint" style={{ fontSize: 12 }}>· {queue.length} waiting</span>}
      </div>

      {!current ? (
        <div className="glass-surface" style={{ borderRadius: 16, padding: "28px 24px", textAlign: "center", marginBottom: 40 }}>
          <div className="display" style={{ fontSize: 26, color: "var(--text-soft)" }}>All clear</div>
          <p className="faint" style={{ fontSize: 13, marginTop: 6, marginBottom: 0 }}>
            Nothing needs your attention right now.
          </p>
        </div>
      ) : (
        <div style={{ marginBottom: 40 }}>
          <DecisionCard key={current.id} decision={current} onResolved={() => refresh()} />
          {queue.length > 1 && (
            <p className="faint" style={{ fontSize: 12, marginTop: 2 }}>
              {queue.length - 1} more after this — handle them one at a time.
            </p>
          )}
        </div>
      )}

      {/* Sessions */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span className="kicker">Sessions</span>
        {sessions.length > 0 && (
          <span className="faint" style={{ fontSize: 12 }}>
            · {sessions.length} total{live ? ` · ${live} active` : ""}{waiting ? ` · ${waiting} waiting` : ""}
          </span>
        )}
      </div>
      {sessions.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>
          No sessions attached. Run <code>redstone claude</code> in a project.
        </p>
      ) : (
        <div className="glass-surface" style={{ borderRadius: 16, padding: "6px 16px" }}>
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s} dot={STATUS_DOT[s.status] ?? "var(--text-faint)"} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 40 }}>
        <Connections />
        <Devices />
      </div>
    </main>
  );
}
