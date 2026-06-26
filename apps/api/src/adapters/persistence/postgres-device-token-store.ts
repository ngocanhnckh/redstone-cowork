import type { Pool } from "pg";
import type { DeviceRecord, DeviceTokenStore } from "../../domain/devices/device-token-store.port";

const ROW = `id, token_hash AS "tokenHash", label, created_at AS "createdAt",
             last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt"`;

function mapRow(row: Record<string, unknown>): DeviceRecord {
  return {
    id: row.id as string,
    tokenHash: row.tokenHash as string,
    label: row.label as string,
    createdAt: new Date(row.createdAt as string | Date),
    lastSeenAt: row.lastSeenAt != null ? new Date(row.lastSeenAt as string | Date) : null,
    revokedAt: row.revokedAt != null ? new Date(row.revokedAt as string | Date) : null,
  };
}

export class PostgresDeviceTokenStore implements DeviceTokenStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: DeviceRecord): Promise<DeviceRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO devices (id, token_hash, label, created_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${ROW}`,
      [rec.id, rec.tokenHash, rec.label, rec.createdAt, rec.lastSeenAt, rec.revokedAt]
    );
    return mapRow(rows[0]);
  }

  async listActive(): Promise<DeviceRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM devices WHERE revoked_at IS NULL ORDER BY created_at DESC`
    );
    return rows.map(mapRow);
  }

  async findByHash(tokenHash: string): Promise<DeviceRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM devices WHERE token_hash=$1`,
      [tokenHash]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE devices SET last_seen_at=$2 WHERE id=$1`,
      [id, at]
    );
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE devices SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`,
      [id, at]
    );
    return (r.rowCount ?? 0) > 0;
  }
}
