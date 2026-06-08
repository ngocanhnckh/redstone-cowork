import type { Pool } from "pg";
import { DecisionSchema, type Decision, type Resolution } from "@rcw/shared";
import type { DecisionStore } from "../../domain/decisions/decision-store.port";

const ROW = `id, session_id AS "sessionId", kind, title, body, options, status, resolution,
             created_at AS "createdAt", resolved_at AS "resolvedAt", delivered_at AS "deliveredAt"`;

export class PostgresDecisionStore implements DecisionStore {
  constructor(private readonly pool: Pool) {}

  async create(d: Decision): Promise<Decision> {
    await this.pool.query(
      `INSERT INTO decisions (id, session_id, kind, title, body, options, status, created_at, resolution, resolved_at, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        d.id, d.sessionId, d.kind, d.title,
        JSON.stringify(d.body), JSON.stringify(d.options),
        d.status, d.createdAt,
        d.resolution ? JSON.stringify(d.resolution) : null,
        d.resolvedAt ?? null,
        d.deliveredAt ?? null,
      ]
    );
    return d;
  }
  async get(id: string): Promise<Decision | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM decisions WHERE id=$1`, [id]);
    return rows[0] ? DecisionSchema.parse(rows[0]) : null;
  }
  async listPending(): Promise<Decision[]> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM decisions WHERE status='pending' ORDER BY created_at DESC`);
    return rows.map((r) => DecisionSchema.parse(r));
  }
  async resolve(id: string, resolution: Resolution, at: Date): Promise<Decision | null> {
    const { rows } = await this.pool.query(
      `UPDATE decisions SET status='resolved', resolution=$2, resolved_at=$3
       WHERE id=$1 AND status='pending' RETURNING ${ROW}`,
      [id, JSON.stringify(resolution), at]
    );
    return rows[0] ? DecisionSchema.parse(rows[0]) : null;
  }
  async countPendingBySession(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT session_id, COUNT(*)::int AS n FROM decisions WHERE status='pending' GROUP BY session_id`);
    return Object.fromEntries(rows.map((r) => [r.session_id, r.n]));
  }
  async listUndelivered(sessionId: string): Promise<Decision[]> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM decisions
       WHERE session_id=$1 AND status='resolved' AND delivered_at IS NULL AND kind IN ('permission','question','instruction','mode')
       ORDER BY created_at ASC`,
      [sessionId]
    );
    return rows.map((r) => DecisionSchema.parse(r));
  }
  async markDelivered(id: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE decisions SET delivered_at=$2 WHERE id=$1`, [id, at]);
  }
  async resolveAllPendingLocal(sessionId: string, at: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE decisions SET status='resolved',
        resolution='{"choice":"__local__","answers":null,"custom":null}'::jsonb,
        resolved_at=$2, delivered_at=$2
       WHERE session_id=$1 AND status='pending' AND kind IN ('permission','question')`,
      [sessionId, at]
    );
    return rowCount ?? 0;
  }
}
