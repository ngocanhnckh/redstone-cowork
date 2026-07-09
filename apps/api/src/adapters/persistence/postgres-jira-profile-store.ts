import type { Pool } from "pg";
import { z } from "zod";
import type { JiraProfileRecord, JiraProfileStore } from "../../domain/jira/jira-profile.port";

const ROW = `name, base_url AS "baseUrl", pat_encrypted AS "patEncrypted", created_at AS "createdAt"`;
const RowSchema = z.object({
  name: z.string(),
  baseUrl: z.string(),
  patEncrypted: z.string(),
  createdAt: z.coerce.date(),
});

export class PostgresJiraProfileStore implements JiraProfileStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<JiraProfileRecord[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM jira_profiles ORDER BY name ASC`);
    return rows.map((r) => RowSchema.parse(r));
  }

  async get(name: string): Promise<JiraProfileRecord | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM jira_profiles WHERE name=$1`, [name]);
    return rows[0] ? RowSchema.parse(rows[0]) : null;
  }

  async upsert(rec: JiraProfileRecord): Promise<JiraProfileRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO jira_profiles (name, base_url, pat_encrypted, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO UPDATE SET base_url=$2, pat_encrypted=$3
       RETURNING ${ROW}`,
      [rec.name, rec.baseUrl, rec.patEncrypted, rec.createdAt],
    );
    return RowSchema.parse(rows[0]);
  }

  async remove(name: string): Promise<void> {
    await this.pool.query(`DELETE FROM jira_profiles WHERE name=$1`, [name]);
  }
}
