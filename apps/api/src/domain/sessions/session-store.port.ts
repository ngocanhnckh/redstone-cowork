import type { AgentSession } from "@rcw/shared";

export interface SessionStore {
  upsert(session: AgentSession): Promise<AgentSession>;
  touch(id: string, at: Date): Promise<boolean>;      // false = unknown id
  get(id: string): Promise<AgentSession | null>;
  list(): Promise<AgentSession[]>;
  getByWrapper(wrapperId: string): Promise<AgentSession | null>;
  setPermissionMode(id: string, mode: string): Promise<void>;
}
export const SESSION_STORE = Symbol("SessionStore");
