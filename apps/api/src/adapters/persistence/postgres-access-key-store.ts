import type { Pool } from "pg";
import { AccessKeySchema, type AccessKey } from "@rcw/shared";
import type { AccessKeyStore, NewAccessKeyRecord } from "../../domain/access-keys/access-key-store.port";

const ROW = `id, name, prefix, scope, created_at AS "createdAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt"`;

export class PostgresAccessKeyStore implements AccessKeyStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: NewAccessKeyRecord): Promise<AccessKey> {
    const { rows } = await this.pool.query(
      `INSERT INTO access_keys (id, name, key_hash, prefix, scope, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${ROW}`,
      [rec.id, rec.name, rec.keyHash, rec.prefix, rec.scope, rec.createdAt]
    );
    return AccessKeySchema.parse(rows[0]);
  }
  async findByHash(keyHash: string): Promise<AccessKey | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM access_keys WHERE key_hash=$1`, [keyHash]);
    return rows[0] ? AccessKeySchema.parse(rows[0]) : null;
  }
  async list(): Promise<AccessKey[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM access_keys ORDER BY created_at DESC`);
    return rows.map((r) => AccessKeySchema.parse(r));
  }
  async revoke(id: string, at: Date): Promise<boolean> {
    const r = await this.pool.query(`UPDATE access_keys SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`, [id, at]);
    return (r.rowCount ?? 0) > 0;
  }
  async touch(id: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE access_keys SET last_used_at=$2 WHERE id=$1`, [id, at]);
  }
}
