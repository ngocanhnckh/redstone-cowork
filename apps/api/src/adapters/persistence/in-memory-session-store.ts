import type { AgentSession, SessionStatePatch, UserTodo } from "@rcw/shared";
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
          // Pin the folder to first-attach so a later resume/relaunch inside a
          // subdirectory doesn't rename the session (title = basename of cwd).
          cwd: existing.cwd,
          permissionMode: s.permissionMode ?? existing.permissionMode,
          latestAnswer: existing.latestAnswer,
          summary: existing.summary,
          todos: existing.todos,
          userTodos: existing.userTodos,
          tags: existing.tags,
          transcript: existing.transcript,
          working: existing.working,
          contextTokens: existing.contextTokens,
          model: existing.model,
          tokensInput: existing.tokensInput,
          tokensOutput: existing.tokensOutput,
          tokenSeries: existing.tokenSeries,
          pinned: existing.pinned,
          snoozedUntil: existing.snoozedUntil,
          jira: existing.jira,
          // Ownership never changes on re-attach; first owner (or seed claim) wins.
          accountId: existing.accountId ?? s.accountId,
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
  // Closed sessions keep their history (retrievable by id) but drop out of lists.
  async list() { return [...this.sessions.values()].filter((s) => !s.closedAt); }
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
      ...(patch.contextTokens !== undefined ? { contextTokens: patch.contextTokens } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.tokensInput !== undefined ? { tokensInput: patch.tokensInput } : {}),
      ...(patch.tokensOutput !== undefined ? { tokensOutput: patch.tokensOutput } : {}),
      ...(patch.tokenSeries !== undefined ? { tokenSeries: patch.tokenSeries } : {}),
      ...(patch.jira !== undefined ? { jira: patch.jira } : {}),
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
  async setUserTodos(id: string, todos: UserTodo[]): Promise<AgentSession | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const next = { ...s, userTodos: todos };
    this.sessions.set(id, next);
    return next;
  }
  async setTags(id: string, tags: string[]): Promise<AgentSession | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const next = { ...s, tags };
    this.sessions.set(id, next);
    return next;
  }
  async close(id: string, at: Date): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, closedAt: s.closedAt ?? at });
  }
  async setAccount(id: string, accountId: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, accountId });
  }
  async claimUnowned(accountId: string): Promise<number> {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (!s.accountId) {
        this.sessions.set(id, { ...s, accountId });
        n++;
      }
    }
    return n;
  }
}
