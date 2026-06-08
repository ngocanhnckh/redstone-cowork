import type { AgentSession } from "@rcw/shared";
import type { SessionStore } from "../../domain/sessions/session-store.port";

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, AgentSession>();
  async upsert(s: AgentSession) {
    const existing = this.sessions.get(s.id);
    const merged = existing
      ? {
          ...existing,
          ...s,
          attachedAt: existing.attachedAt,
          // PRESERVE permissionMode when the incoming value is null (events without a mode must not wipe it)
          permissionMode: s.permissionMode ?? existing.permissionMode,
        }
      : s;
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
  async getByWrapper(wrapperId: string): Promise<AgentSession | null> {
    const matches = [...this.sessions.values()]
      .filter((s) => s.wrapperId === wrapperId)
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    return matches[0] ?? null;
  }
  async setPermissionMode(id: string, mode: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, permissionMode: mode });
  }
}
