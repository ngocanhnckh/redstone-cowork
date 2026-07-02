import type { Pool } from "pg";
import {
  HostSchema, DiscoveredSessionSchema, HostCommandSchema,
  type Host, type DiscoveredSession, type ScannedSession, type HostCommand,
} from "@rcw/shared";
import type { InventoryStore } from "../../domain/inventory/inventory-store.port";

const HOST_ROW = `id, machine, "user", os, last_seen_at AS "lastSeenAt", created_at AS "createdAt"`;
const DISC_ROW = `id, host_id AS "hostId", machine, cwd, folder, title, last_active AS "lastActive",
  message_count AS "messageCount", size_bytes AS "sizeBytes", source, tags, updated_at AS "updatedAt"`;
const CMD_ROW = `id, host_id AS "hostId", kind, payload, status, result, created_at AS "createdAt"`;

const folderOf = (cwd: string): string => cwd.split("/").filter(Boolean).pop() ?? cwd;

export class PostgresInventoryStore implements InventoryStore {
  constructor(private readonly pool: Pool) {}

  async upsertHost(input: { id: string; machine: string; user: string | null; os: string | null; at: Date }): Promise<Host> {
    const { rows } = await this.pool.query(
      `INSERT INTO hosts (id, machine, "user", os, last_seen_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET machine=$2, "user"=$3, os=$4, last_seen_at=$5
       RETURNING ${HOST_ROW}`,
      [input.id, input.machine, input.user, input.os, input.at]
    );
    return HostSchema.parse(rows[0]);
  }
  async touchHost(id: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE hosts SET last_seen_at=$2 WHERE id=$1`, [id, at]);
  }
  async listHosts(): Promise<Host[]> {
    const { rows } = await this.pool.query(`SELECT ${HOST_ROW} FROM hosts ORDER BY last_seen_at DESC`);
    return rows.map((r) => HostSchema.parse(r));
  }

  async reportInventory(hostId: string, machine: string, sessions: ScannedSession[], coworkIds: Set<string>, at: Date): Promise<void> {
    // Upsert each scanned session; preserve user tags across rescans (only set on insert).
    for (const s of sessions) {
      await this.pool.query(
        `INSERT INTO discovered_sessions (id, host_id, machine, cwd, folder, title, last_active, message_count, size_bytes, source, tags, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,$11)
         ON CONFLICT (id) DO UPDATE SET host_id=$2, machine=$3, cwd=$4, folder=$5,
           title=COALESCE($6, discovered_sessions.title), last_active=$7, message_count=$8,
           size_bytes=$9, source=$10, updated_at=$11`,
        [s.id, hostId, machine, s.cwd, folderOf(s.cwd), s.title ?? null, s.lastActive,
         s.messageCount, s.sizeBytes, coworkIds.has(s.id) ? "cowork" : "external", at]
      );
    }
  }
  async listDiscovered(filter?: { hostId?: string; folder?: string; tag?: string; source?: string }): Promise<DiscoveredSession[]> {
    const where: string[] = [];
    const vals: unknown[] = [];
    if (filter?.hostId) { vals.push(filter.hostId); where.push(`host_id = $${vals.length}`); }
    if (filter?.folder) { vals.push(filter.folder); where.push(`folder = $${vals.length}`); }
    if (filter?.source) { vals.push(filter.source); where.push(`source = $${vals.length}`); }
    if (filter?.tag) { vals.push(JSON.stringify([filter.tag])); where.push(`tags @> $${vals.length}::jsonb`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await this.pool.query(`SELECT ${DISC_ROW} FROM discovered_sessions ${clause} ORDER BY last_active DESC`, vals);
    return rows.map((r) => DiscoveredSessionSchema.parse(r));
  }
  async getDiscovered(id: string): Promise<DiscoveredSession | null> {
    const { rows } = await this.pool.query(`SELECT ${DISC_ROW} FROM discovered_sessions WHERE id=$1`, [id]);
    return rows[0] ? DiscoveredSessionSchema.parse(rows[0]) : null;
  }
  async setTags(id: string, tags: string[]): Promise<DiscoveredSession | null> {
    const { rows } = await this.pool.query(
      `UPDATE discovered_sessions SET tags=$2::jsonb WHERE id=$1 RETURNING ${DISC_ROW}`,
      [id, JSON.stringify(tags)]
    );
    return rows[0] ? DiscoveredSessionSchema.parse(rows[0]) : null;
  }

  async enqueueCommand(cmd: HostCommand): Promise<HostCommand> {
    const { rows } = await this.pool.query(
      `INSERT INTO host_commands (id, host_id, kind, payload, status, result, created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING ${CMD_ROW}`,
      [cmd.id, cmd.hostId, cmd.kind, JSON.stringify(cmd.payload), cmd.status, cmd.result, cmd.createdAt]
    );
    return HostCommandSchema.parse(rows[0]);
  }
  async listPendingCommands(hostId: string): Promise<HostCommand[]> {
    const { rows } = await this.pool.query(
      `SELECT ${CMD_ROW} FROM host_commands WHERE host_id=$1 AND status='pending' ORDER BY created_at ASC`,
      [hostId]
    );
    return rows.map((r) => HostCommandSchema.parse(r));
  }
  async completeCommand(id: string, result: Record<string, unknown>): Promise<HostCommand | null> {
    const { rows } = await this.pool.query(
      `UPDATE host_commands SET status='done', result=$2::jsonb WHERE id=$1 RETURNING ${CMD_ROW}`,
      [id, JSON.stringify(result)]
    );
    return rows[0] ? HostCommandSchema.parse(rows[0]) : null;
  }
  async getCommand(id: string): Promise<HostCommand | null> {
    const { rows } = await this.pool.query(`SELECT ${CMD_ROW} FROM host_commands WHERE id=$1`, [id]);
    return rows[0] ? HostCommandSchema.parse(rows[0]) : null;
  }
}
