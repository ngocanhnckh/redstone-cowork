import type { IngestedEvent } from "@rcw/shared";

export interface IngestedEventStore {
  /** Idempotent insert keyed by (source, sourceId, type). Returns how many were newly inserted. */
  appendMany(events: IngestedEvent[]): Promise<number>;
  recent(limit: number): Promise<IngestedEvent[]>;
}
export const INGESTED_EVENT_STORE = Symbol("IngestedEventStore");
