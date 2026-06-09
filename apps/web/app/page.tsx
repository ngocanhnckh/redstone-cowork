"use client";
import { useCallback, useEffect, useState } from "react";
import { DecisionCard, type Decision } from "../components/DecisionCard";
import { SessionRow } from "../components/SessionRow";
import { NotificationsToggle } from "../components/NotificationsToggle";
import { Connections } from "../components/Connections";

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

// Actionable decisions (a question to answer, a permission to grant) surface
// before passive ones (notifications, completions). Within each, oldest first
// so nothing gets buried.
const PRIORITY: Record<string, number> = { question: 0, permission: 0 };
function queueOrder(a: Decision, b: Decision): number {
  const pa = PRIORITY[a.kind] ?? 1;
  const pb = PRIORITY[b.kind] ?? 1;
  if (pa !== pb) return pa - pb;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

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
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>
        Situation Room <span style={{ fontSize: 14, opacity: 0.5 }}>(M1 preview)</span>
      </h1>

      <NotificationsToggle />

      {/* ── Focus queue: one decision at a time ─────────────────────────── */}
      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, opacity: 0.8, display: "flex", alignItems: "baseline", gap: 8 }}>
          Needs you
          {queue.length > 0 && (
            <span style={{ fontSize: 13, opacity: 0.7 }}>
              · {queue.length} waiting
            </span>
          )}
        </h2>

        {!current && (
          <p style={{ opacity: 0.5, padding: "12px 0" }}>All clear, boss. 🟢</p>
        )}

        {current && (
          <>
            <DecisionCard key={current.id} decision={current} onResolved={() => refresh()} />
            {queue.length > 1 && (
              <p style={{ fontSize: 12, opacity: 0.45, marginTop: -4 }}>
                {queue.length - 1} more after this — handle them one at a time.
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Monitoring: status of every session ─────────────────────────── */}
      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 16, opacity: 0.8, display: "flex", alignItems: "baseline", gap: 8 }}>
          Sessions
          {sessions.length > 0 && (
            <span style={{ fontSize: 13, opacity: 0.6 }}>
              · {sessions.length} total{live ? ` · ${live} active` : ""}{waiting ? ` · ${waiting} waiting` : ""}
            </span>
          )}
        </h2>
        {sessions.length === 0 && (
          <p style={{ opacity: 0.5 }}>
            No sessions attached. Run <code>redstone-claude</code> in a project.
          </p>
        )}
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} />
        ))}
      </section>

      <Connections />
    </main>
  );
}
