import type { DomainEvent } from "@rcw/shared";

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  list(limit?: number): Promise<DomainEvent[]>;
}

export const EVENT_STORE = Symbol("EventStore");
