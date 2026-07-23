import type { AgentSession, SessionStatePatch, UserTodo } from "@rcw/shared";

export interface SessionStore {
  upsert(session: AgentSession): Promise<AgentSession>;
  touch(id: string, at: Date): Promise<boolean>;      // false = unknown id
  get(id: string): Promise<AgentSession | null>;
  list(): Promise<AgentSession[]>;
  getByWrapper(wrapperId: string): Promise<AgentSession | null>;
  setPermissionMode(id: string, mode: string): Promise<void>;
  patchState(id: string, patch: SessionStatePatch): Promise<AgentSession | null>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setSnoozedUntil(id: string, until: Date | null): Promise<void>;
  setUserTodos(id: string, todos: UserTodo[]): Promise<AgentSession | null>;
  setTags(id: string, tags: string[]): Promise<AgentSession | null>;
  /** Soft-close: stamp closedAt=now (idempotent — keeps the first close time). */
  close(id: string, at: Date): Promise<void>;
  /** Assign a session to an account (enterprise ownership). */
  setAccount(id: string, accountId: string): Promise<void>;
  /** Claim every unowned session (accountId=null) for the given account. Returns count. */
  claimUnowned(accountId: string): Promise<number>;
}
export const SESSION_STORE = Symbol("SessionStore");
