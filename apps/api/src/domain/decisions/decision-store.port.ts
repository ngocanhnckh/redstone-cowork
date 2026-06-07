import type { Decision, Resolution } from "@rcw/shared";

export interface DecisionStore {
  create(d: Decision): Promise<Decision>;
  get(id: string): Promise<Decision | null>;
  listPending(): Promise<Decision[]>;
  /** Atomic: only succeeds if still pending. Returns null when already resolved/unknown. */
  resolve(id: string, resolution: Resolution, at: Date): Promise<Decision | null>;
  countPendingBySession(): Promise<Record<string, number>>;
}
export const DECISION_STORE = Symbol("DecisionStore");
