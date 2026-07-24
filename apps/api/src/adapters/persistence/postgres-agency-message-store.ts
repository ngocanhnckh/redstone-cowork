import type { Pool } from "pg";
import { z } from "zod";
import type { AgencyMessageRecord, AgencyMessageStore, AgencyThread } from "../../domain/agency/agency-message.port";

const ROW = `id, channel, from_account AS "fromAccount", to_account AS "toAccount", body, attachments, created_at AS "createdAt"`;
const RowSchema = z.object({
  id: z.string(),
  channel: z.string(),
  fromAccount: z.string(),
  toAccount: z.string().nullable(),
  body: z.string(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), size: z.number(), mime: z.string() })).catch([]),
  createdAt: z.coerce.date(),
});

export class PostgresAgencyMessageStore implements AgencyMessageStore {
  constructor(private readonly pool: Pool) {}

  async post(rec: AgencyMessageRecord): Promise<AgencyMessageRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO agency_messages (id, channel, from_account, to_account, body, attachments, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING ${ROW}`,
      [rec.id, rec.channel, rec.fromAccount, rec.toAccount, rec.body, JSON.stringify(rec.attachments), rec.createdAt],
    );
    return RowSchema.parse(rows[0]);
  }

  async list(channel: string, opts?: { limit?: number; afterId?: string }): Promise<AgencyMessageRecord[]> {
    const limit = Math.min(500, opts?.limit ?? 200);
    if (opts?.afterId) {
      const { rows } = await this.pool.query(
        `SELECT ${ROW} FROM agency_messages
         WHERE channel=$1 AND created_at > (SELECT created_at FROM agency_messages WHERE id=$2)
         ORDER BY created_at ASC LIMIT $3`,
        [channel, opts.afterId, limit],
      );
      return rows.map((r) => RowSchema.parse(r));
    }
    // Newest `limit`, returned oldest→newest.
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM (
         SELECT * FROM agency_messages WHERE channel=$1 ORDER BY created_at DESC LIMIT $2
       ) t ORDER BY created_at ASC`,
      [channel, limit],
    );
    return rows.map((r) => RowSchema.parse(r));
  }

  async threadsFor(accountId: string): Promise<AgencyThread[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (channel) channel,
         CASE WHEN from_account=$1 THEN to_account ELSE from_account END AS "otherAccountId",
         created_at AS "lastAt"
       FROM agency_messages
       WHERE channel <> 'org' AND (from_account=$1 OR to_account=$1)
       ORDER BY channel, created_at DESC`,
      [accountId],
    );
    return rows
      .filter((r) => r.otherAccountId)
      .map((r) => ({ channel: String(r.channel), otherAccountId: String(r.otherAccountId), lastAt: new Date(r.lastAt) }))
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  }
}
