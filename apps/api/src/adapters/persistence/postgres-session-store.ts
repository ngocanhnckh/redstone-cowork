import type { Pool } from "pg";
import { AgentSessionSchema, type AgentSession } from "@rcw/shared";
import type { SessionStore } from "../../domain/sessions/session-store.port";

const ROW = `id, machine, cwd, git_branch AS "gitBranch", attached_at AS "attachedAt", last_seen_at AS "lastSeenAt", wrapper_id AS "wrapperId"`;

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async upsert(s: AgentSession): Promise<AgentSession> {
    const { rows } = await this.pool.query(
      `INSERT INTO sessions (id, machine, cwd, git_branch, attached_at, last_seen_at, wrapper_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET machine=$2, cwd=$3, git_branch=$4, last_seen_at=$6, wrapper_id=$7
       RETURNING ${ROW}`,
      [s.id, s.machine, s.cwd, s.gitBranch, s.attachedAt, s.lastSeenAt, s.wrapperId ?? null]
    );
    return AgentSessionSchema.parse(rows[0]);
  }
  async touch(id: string, at: Date): Promise<boolean> {
    const r = await this.pool.query("UPDATE sessions SET last_seen_at=$2 WHERE id=$1", [id, at]);
    return (r.rowCount ?? 0) > 0;
  }
  async get(id: string): Promise<AgentSession | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM sessions WHERE id=$1`, [id]);
    return rows[0] ? AgentSessionSchema.parse(rows[0]) : null;
  }
  async list(): Promise<AgentSession[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM sessions ORDER BY last_seen_at DESC`);
    return rows.map((r) => AgentSessionSchema.parse(r));
  }
  async getByWrapper(wrapperId: string): Promise<AgentSession | null> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM sessions WHERE wrapper_id=$1 ORDER BY last_seen_at DESC LIMIT 1`,
      [wrapperId]
    );
    return rows[0] ? AgentSessionSchema.parse(rows[0]) : null;
  }
}
