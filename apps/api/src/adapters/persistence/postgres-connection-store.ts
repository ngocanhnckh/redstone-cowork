import type { Pool } from "pg";
import type { ConnectorKind, ConnectionStatus } from "@rcw/shared";
import type { ConnectionStore, ConnectionRecord } from "../../domain/integrations/connection-store.port";

const ROW = `id, kind, endpoint, label, config, secret_cipher AS "secretCipher", cursor, status,
             last_sync_at AS "lastSyncAt", last_error AS "lastError", created_at AS "createdAt"`;

type Row = Omit<ConnectionRecord, "kind" | "status"> & { kind: string; status: string };
const map = (r: Row): ConnectionRecord => ({ ...r, kind: r.kind as ConnectorKind, status: r.status as ConnectionStatus });

export class PostgresConnectionStore implements ConnectionStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: ConnectionRecord): Promise<ConnectionRecord> {
    await this.pool.query(
      `INSERT INTO connections (id, kind, endpoint, label, config, secret_cipher, cursor, status, last_sync_at, last_error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [rec.id, rec.kind, rec.endpoint, rec.label, JSON.stringify(rec.config), rec.secretCipher,
       JSON.stringify(rec.cursor), rec.status, rec.lastSyncAt, rec.lastError, rec.createdAt],
    );
    return rec;
  }
  async list(): Promise<ConnectionRecord[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM connections ORDER BY created_at ASC`);
    return rows.map(map);
  }
  async get(id: string): Promise<ConnectionRecord | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM connections WHERE id=$1`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }
  async updateSync(id: string, patch: Pick<ConnectionRecord, "cursor" | "status" | "lastError" | "lastSyncAt">): Promise<void> {
    await this.pool.query(
      `UPDATE connections SET cursor=$2, status=$3, last_error=$4, last_sync_at=$5 WHERE id=$1`,
      [id, JSON.stringify(patch.cursor), patch.status, patch.lastError, patch.lastSyncAt],
    );
  }
  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM connections WHERE id=$1`, [id]);
  }
}
