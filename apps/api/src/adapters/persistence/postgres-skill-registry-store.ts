import type { Pool } from "pg";
import { SkillFileSchema } from "@rcw/shared";
import { z } from "zod";
import type { SkillRegistryEntry, SkillRegistryStore } from "../../domain/skills/skill-registry.port";

const ROW = `name, description, source, hash, files, origin_host_id AS "originHostId", updated_at AS "updatedAt"`;

const RowSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  source: z.string(),
  hash: z.string(),
  files: z.array(SkillFileSchema),
  originHostId: z.string().nullable(),
  updatedAt: z.coerce.date(),
});

export class PostgresSkillRegistryStore implements SkillRegistryStore {
  constructor(private readonly pool: Pool) {}

  async get(name: string): Promise<SkillRegistryEntry | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM skill_registry WHERE name=$1`, [name]);
    return rows[0] ? RowSchema.parse(rows[0]) : null;
  }
  async list(): Promise<SkillRegistryEntry[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM skill_registry ORDER BY name ASC`);
    return rows.map((r) => RowSchema.parse(r));
  }
  async upsert(entry: SkillRegistryEntry): Promise<SkillRegistryEntry> {
    const { rows } = await this.pool.query(
      `INSERT INTO skill_registry (name, description, source, hash, files, origin_host_id, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (name) DO UPDATE SET description=$2, source=$3, hash=$4, files=$5::jsonb,
         origin_host_id=$6, updated_at=$7
       RETURNING ${ROW}`,
      [entry.name, entry.description, entry.source, entry.hash, JSON.stringify(entry.files), entry.originHostId, entry.updatedAt]
    );
    return RowSchema.parse(rows[0]);
  }
}
