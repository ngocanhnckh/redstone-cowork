import type { Pool } from "pg";
import type { LlmEndpointStore, StoredLlmEndpoint } from "../../domain/llm/llm-endpoint-store.port";

const ROW = `id, label, base_url AS "baseUrl", model, key_cipher AS "keyCipher", max_tokens AS "maxTokens", created_at AS "createdAt"`;

export class PostgresLlmEndpointStore implements LlmEndpointStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<StoredLlmEndpoint[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM llm_endpoints ORDER BY created_at ASC`);
    return rows as StoredLlmEndpoint[];
  }
  async create(rec: StoredLlmEndpoint): Promise<StoredLlmEndpoint> {
    await this.pool.query(
      `INSERT INTO llm_endpoints (id, label, base_url, model, key_cipher, max_tokens, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rec.id, rec.label, rec.baseUrl, rec.model, rec.keyCipher, rec.maxTokens, rec.createdAt]
    );
    return rec;
  }
  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM llm_endpoints WHERE id = $1`, [id]);
  }
}
