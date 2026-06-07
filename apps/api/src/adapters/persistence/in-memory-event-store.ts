import type { DomainEvent } from "@rcw/shared";
import type { EventStore } from "../../domain/events/event-store.port";

export class InMemoryEventStore implements EventStore {
  private events: DomainEvent[] = [];
  async append(event: DomainEvent) { this.events.push(event); }
  async list(limit = 100) { return this.events.slice(-limit).reverse(); }
}
