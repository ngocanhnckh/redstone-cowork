import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { IngestedEventSchema, type IngestedEvent } from "@rcw/shared";
import type { IngestedEventStore } from "../../domain/integrations/ingested-event-store.port";

export class PostgresIngestedEventStore implements IngestedEventStore {
  constructor(private readonly pool: Pool) {}

  async appendMany(events: IngestedEvent[]): Promise<number> {
    let inserted = 0;
    for (const e of events) {
      const { rowCount } = await this.pool.query(
        `INSERT INTO ingested_events (id, source, source_id, type, occurred_at, actor, payload, links)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (source, source_id, type) DO NOTHING`,
        [randomUUID(), e.source, e.sourceId, e.type, e.occurredAt, e.actor, JSON.stringify(e.payload), JSON.stringify(e.links)],
      );
      inserted += rowCount ?? 0;
    }
    return inserted;
  }
  async recent(limit: number): Promise<IngestedEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT source, source_id AS "sourceId", type, occurred_at AS "occurredAt", actor, payload, links
       FROM ingested_events ORDER BY occurred_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => IngestedEventSchema.parse(r));
  }
}
