import type { Pool } from "pg";
import { ServerSchema, type Server } from "@rcw/shared";
import type { ServerStore, NewServerRecord } from "../../domain/servers/server-store.port";

const ROW = `id, name, host, ssh_user AS "sshUser", ssh_port AS "sshPort", description,
             owner_account_id AS "ownerAccountId", key_installed AS "keyInstalled",
             created_by AS "createdBy", created_at AS "createdAt"`;

export class PostgresServerStore implements ServerStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: NewServerRecord): Promise<Server> {
    const { rows } = await this.pool.query(
      `INSERT INTO servers (id, name, host, ssh_user, ssh_port, description, owner_account_id, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ROW}`,
      [rec.id, rec.name, rec.host, rec.sshUser, rec.sshPort, rec.description, rec.ownerAccountId, rec.createdBy, rec.createdAt]
    );
    return ServerSchema.parse(rows[0]);
  }
  async get(id: string): Promise<Server | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM servers WHERE id=$1`, [id]);
    return rows[0] ? ServerSchema.parse(rows[0]) : null;
  }
  async listAll(): Promise<Server[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM servers ORDER BY name`);
    return rows.map((r) => ServerSchema.parse(r));
  }
  async listForAccount(accountId: string): Promise<Server[]> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM servers s
       WHERE s.owner_account_id = $1
          OR (s.owner_account_id IS NULL AND EXISTS (
                SELECT 1 FROM server_access a WHERE a.server_id = s.id AND a.account_id = $1))
       ORDER BY name`,
      [accountId]
    );
    return rows.map((r) => ServerSchema.parse(r));
  }
  async update(id: string, patch: Partial<Server>): Promise<Server | null> {
    const cols: Record<string, string> = { name: "name", host: "host", sshUser: "ssh_user", sshPort: "ssh_port", description: "description", keyInstalled: "key_installed" };
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const [k, col] of Object.entries(cols)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v !== undefined) { vals.push(v); sets.push(`${col}=$${vals.length}`); }
    }
    if (!sets.length) return this.get(id);
    const { rows } = await this.pool.query(`UPDATE servers SET ${sets.join(", ")} WHERE id=$1 RETURNING ${ROW}`, vals);
    return rows[0] ? ServerSchema.parse(rows[0]) : null;
  }
  async remove(id: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM servers WHERE id=$1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }
  async grant(serverId: string, accountId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO server_access (server_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [serverId, accountId]
    );
  }
  async revoke(serverId: string, accountId: string): Promise<void> {
    await this.pool.query(`DELETE FROM server_access WHERE server_id=$1 AND account_id=$2`, [serverId, accountId]);
  }
  async accessUsernames(serverId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT a.username FROM server_access sa JOIN accounts a ON a.id = sa.account_id WHERE sa.server_id=$1 ORDER BY a.username`,
      [serverId]
    );
    return rows.map((r) => r.username as string);
  }
  async canAccess(serverId: string, accountId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM servers s WHERE s.id=$1 AND (s.owner_account_id=$2
         OR EXISTS (SELECT 1 FROM server_access a WHERE a.server_id=s.id AND a.account_id=$2)) LIMIT 1`,
      [serverId, accountId]
    );
    return rows.length > 0;
  }
}
