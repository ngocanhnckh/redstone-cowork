import type { Pool } from "pg";
import { z } from "zod";
import type { ClaudeConfigRecord, ClaudeConfigStore } from "../../domain/claude-configs/claude-config.port";

const ROW = `name, env_encrypted AS "envEncrypted"`;
const RowSchema = z.object({ name: z.string(), envEncrypted: z.string() });
const NameRowSchema = z.object({ name: z.string() });

export class PostgresClaudeConfigStore implements ClaudeConfigStore {
  constructor(private readonly pool: Pool) {}

  async get(name: string): Promise<ClaudeConfigRecord | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM claude_configs WHERE name=$1`, [name]);
    return rows[0] ? RowSchema.parse(rows[0]) : null;
  }

  async list(): Promise<{ name: string }[]> {
    const { rows } = await this.pool.query(`SELECT name FROM claude_configs ORDER BY name ASC`);
    return rows.map((r) => NameRowSchema.parse(r));
  }

  async upsert(name: string, envEncrypted: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO claude_configs (name, env_encrypted) VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET env_encrypted=$2`,
      [name, envEncrypted],
    );
  }

  async remove(name: string): Promise<void> {
    await this.pool.query(`DELETE FROM claude_configs WHERE name=$1`, [name]);
  }
}
