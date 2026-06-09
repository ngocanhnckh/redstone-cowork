import type { Decision, Resolution } from "@rcw/shared";

export interface DecisionStore {
  create(d: Decision): Promise<Decision>;
  get(id: string): Promise<Decision | null>;
  listPending(): Promise<Decision[]>;
  /** Atomic: only succeeds if still pending. Returns null when already resolved/unknown. */
  resolve(id: string, resolution: Resolution, at: Date): Promise<Decision | null>;
  countPendingBySession(): Promise<Record<string, number>>;
  /** Returns resolved decisions with no deliveredAt for this session (permission|question|instruction). */
  listUndelivered(sessionId: string): Promise<Decision[]>;
  markDelivered(id: string, at: Date): Promise<void>;
  /** Resolves pending permission|question decisions as __local__ and marks them delivered. Returns count. */
  resolveAllPendingLocal(sessionId: string, at: Date): Promise<number>;
  /** Resolves prior pending decisions of the given kinds for a session, superseded by a newer one. Returns count. */
  supersedePending(sessionId: string, kinds: string[], at: Date): Promise<number>;
}
export const DECISION_STORE = Symbol("DecisionStore");
