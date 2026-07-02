import type { Pool } from "pg";
import type { SettingsStore } from "../../application/settings.service";

export class PostgresSettingsStore implements SettingsStore {
  constructor(private readonly pool: Pool) {}
  async get(key: string): Promise<string | null> {
    const { rows } = await this.pool.query(`SELECT value FROM instance_settings WHERE key=$1`, [key]);
    return rows[0]?.value ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO instance_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=$2`,
      [key, value]
    );
  }
}
