"use client";
import { useCallback, useEffect, useState } from "react";
import { DecisionCard, type Decision } from "../components/DecisionCard";
import { SessionRow } from "../components/SessionRow";

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

  return (
    <main style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>
        Situation Room{" "}
        <span style={{ fontSize: 14, opacity: 0.5 }}>(M1 preview)</span>
      </h1>
      <h2 style={{ fontSize: 16, opacity: 0.8 }}>
        Decisions waiting on you{" "}
        {decisions.length > 0 && `(${decisions.length})`}
      </h2>
      {decisions.length === 0 && <p style={{ opacity: 0.5 }}>All clear, boss.</p>}
      {decisions.map((d) => (
        <DecisionCard key={d.id} decision={d} onResolved={() => refresh()} />
      ))}
      <h2 style={{ fontSize: 16, opacity: 0.8, marginTop: 32 }}>Sessions</h2>
      {sessions.length === 0 && (
        <p style={{ opacity: 0.5 }}>
          No sessions attached. Run <code>redstone hook</code> in a project.
        </p>
      )}
      {sessions.map((s) => (
        <SessionRow key={s.id} s={s} />
      ))}
    </main>
  );
}
