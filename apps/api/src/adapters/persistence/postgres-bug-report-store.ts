import type { Pool } from "pg";
import type { BugReportRecord, BugReportStore } from "../../domain/reports/bug-report.port";

type Row = {
  id: string; account_id: string | null; username: string; message: string;
  log: string; context: Record<string, unknown>; status: string; created_at: Date;
};

const toRecord = (r: Row): BugReportRecord => ({
  id: r.id,
  accountId: r.account_id,
  username: r.username,
  message: r.message,
  log: r.log,
  context: r.context ?? {},
  status: r.status === "closed" ? "closed" : "open",
  createdAt: r.created_at,
});

export class PostgresBugReportStore implements BugReportStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: BugReportRecord): Promise<BugReportRecord> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO bug_reports (id, account_id, username, message, log, context, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
      [rec.id, rec.accountId, rec.username, rec.message, rec.log, JSON.stringify(rec.context), rec.status, rec.createdAt],
    );
    return toRecord(rows[0]);
  }

  async list(opts?: { limit?: number; status?: "open" | "closed" }): Promise<BugReportRecord[]> {
    const limit = Math.min(500, Math.max(1, opts?.limit ?? 100));
    const { rows } = opts?.status
      ? await this.pool.query<Row>(`SELECT * FROM bug_reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [opts.status, limit])
      : await this.pool.query<Row>(`SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map(toRecord);
  }

  async setStatus(id: string, status: "open" | "closed"): Promise<void> {
    await this.pool.query(`UPDATE bug_reports SET status = $2 WHERE id = $1`, [id, status]);
  }
}
