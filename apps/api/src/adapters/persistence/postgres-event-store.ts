import type { Pool } from "pg";
import { DomainEventSchema, type DomainEvent } from "@rcw/shared";
import type { EventStore } from "../../domain/events/event-store.port";

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async append(e: DomainEvent): Promise<void> {
    await this.pool.query(
      "INSERT INTO domain_events (id, type, source, occurred_at, payload) VALUES ($1,$2,$3,$4,$5)",
      [e.id, e.type, e.source, e.occurredAt, JSON.stringify(e.payload)]
    );
  }

  async list(limit = 100): Promise<DomainEvent[]> {
    const { rows } = await this.pool.query(
      "SELECT id, type, source, occurred_at AS \"occurredAt\", payload FROM domain_events ORDER BY occurred_at DESC LIMIT $1",
      [limit]
    );
    return rows.map((r) => DomainEventSchema.parse(r));
  }
}
