import { Inject, Injectable } from "@nestjs/common";
import { NewAgentSessionSchema, type AgentSession, type SessionStatus } from "@rcw/shared";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";

export type SessionView = AgentSession & { status: SessionStatus; pendingDecisions: number };

const ACTIVE_MS = 90_000;
const STALE_MS = 300_000;

export const sessionStatus = (s: AgentSession, pending: number, now: Date): SessionStatus => {
  if (pending > 0) return "waiting";
  const age = now.getTime() - s.lastSeenAt.getTime();
  if (age < ACTIVE_MS) return "active";
  if (age < STALE_MS) return "stale";
  return "lost";
};

@Injectable()
export class SessionsService {
  constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

  async attach(input: unknown): Promise<AgentSession> {
    const parsed = NewAgentSessionSchema.parse(input);
    const now = new Date();
    return this.store.upsert({ ...parsed, attachedAt: now, lastSeenAt: now });
  }
  async heartbeat(id: string): Promise<boolean> {
    return this.store.touch(id, new Date());
  }
  async listViews(pendingBySession: Record<string, number>): Promise<SessionView[]> {
    const now = new Date();
    return (await this.store.list()).map((s) => ({
      ...s,
      pendingDecisions: pendingBySession[s.id] ?? 0,
      status: sessionStatus(s, pendingBySession[s.id] ?? 0, now),
    }));
  }
  get(id: string) { return this.store.get(id); }
}
