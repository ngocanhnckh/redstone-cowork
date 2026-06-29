import type { AgentSession, SessionStatePatch } from "@rcw/shared";
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
          permissionMode: s.permissionMode ?? existing.permissionMode,
          latestAnswer: existing.latestAnswer,
          summary: existing.summary,
          todos: existing.todos,
          transcript: existing.transcript,
          working: existing.working,
          pinned: existing.pinned,
          snoozedUntil: existing.snoozedUntil,
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
  async patchState(id: string, patch: SessionStatePatch): Promise<AgentSession | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const next: AgentSession = {
      ...s,
      ...(patch.latestAnswer !== undefined ? { latestAnswer: patch.latestAnswer } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.todos !== undefined ? { todos: patch.todos } : {}),
      ...(patch.transcript !== undefined ? { transcript: patch.transcript } : {}),
      ...(patch.working !== undefined ? { working: patch.working } : {}),
    };
    this.sessions.set(id, next);
    return next;
  }
  async setPinned(id: string, pinned: boolean): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, pinned });
  }
  async setSnoozedUntil(id: string, until: Date | null): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, snoozedUntil: until });
  }
}
