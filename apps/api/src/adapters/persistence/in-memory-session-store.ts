import type { AgentSession } from "@rcw/shared";
import type { SessionStore } from "../../domain/sessions/session-store.port";

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, AgentSession>();
  async upsert(s: AgentSession) {
    const existing = this.sessions.get(s.id);
    const merged = existing ? { ...existing, ...s, attachedAt: existing.attachedAt } : s;
    this.sessions.set(s.id, merged);
    return merged;
  }
  async touch(id: string, at: Date) {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.lastSeenAt = at;
    return true;
  }
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async list() { return [...this.sessions.values()]; }
}
