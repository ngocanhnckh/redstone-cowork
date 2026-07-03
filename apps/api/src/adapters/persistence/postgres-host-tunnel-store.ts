import type { Pool } from "pg";
import { z } from "zod";
import type { CockpitKeyEntry, HostTunnelEntry, HostTunnelStore } from "../../domain/tunnels/host-tunnel.port";

const ROW = `host_id AS "hostId", tunnel_port AS "tunnelPort", agent_pubkey AS "agentPubkey", created_at AS "createdAt"`;

const RowSchema = z.object({
  hostId: z.string(),
  tunnelPort: z.coerce.number(),
  agentPubkey: z.string(),
  createdAt: z.coerce.date(),
});

const CockpitRowSchema = z.object({ label: z.string(), pubkey: z.string() });

export class PostgresHostTunnelStore implements HostTunnelStore {
  constructor(private readonly pool: Pool) {}

  async get(hostId: string): Promise<HostTunnelEntry | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM host_tunnels WHERE host_id=$1`, [hostId]);
    return rows[0] ? RowSchema.parse(rows[0]) : null;
  }

  async list(): Promise<HostTunnelEntry[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM host_tunnels ORDER BY tunnel_port ASC`);
    return rows.map((r) => RowSchema.parse(r));
  }

  async upsert(hostId: string, pubkey: string): Promise<HostTunnelEntry> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(`SELECT ${ROW} FROM host_tunnels WHERE host_id=$1`, [hostId]);
      if (existing.rows[0]) {
        const { rows } = await client.query(
          `UPDATE host_tunnels SET agent_pubkey=$2 WHERE host_id=$1 RETURNING ${ROW}`,
          [hostId, pubkey],
        );
        await client.query("COMMIT");
        return RowSchema.parse(rows[0]);
      }
      // Serialize port assignment so two concurrent new hosts can't pick the same port.
      await client.query("LOCK TABLE host_tunnels IN EXCLUSIVE MODE");
      const {
        rows: [{ port }],
      } = await client.query(
        `SELECT (SELECT MIN(s) FROM generate_series(30000,
            COALESCE((SELECT MAX(tunnel_port) FROM host_tunnels), 29999) + 1) s
          WHERE s NOT IN (SELECT tunnel_port FROM host_tunnels)) AS port`,
      );
      const { rows } = await client.query(
        `INSERT INTO host_tunnels (host_id, tunnel_port, agent_pubkey) VALUES ($1,$2,$3) RETURNING ${ROW}`,
        [hostId, port, pubkey],
      );
      await client.query("COMMIT");
      return RowSchema.parse(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async addCockpitKey(label: string, pubkey: string): Promise<CockpitKeyEntry> {
    const { rows } = await this.pool.query(
      `INSERT INTO tunnel_cockpit_keys (label, pubkey) VALUES ($1,$2)
       ON CONFLICT (label) DO UPDATE SET pubkey=$2
       RETURNING label, pubkey`,
      [label, pubkey],
    );
    return CockpitRowSchema.parse(rows[0]);
  }

  async listCockpitKeys(): Promise<CockpitKeyEntry[]> {
    const { rows } = await this.pool.query(`SELECT label, pubkey FROM tunnel_cockpit_keys ORDER BY label ASC`);
    return rows.map((r) => CockpitRowSchema.parse(r));
  }
}
