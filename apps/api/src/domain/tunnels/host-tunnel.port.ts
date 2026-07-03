/** One host's reverse-tunnel assignment: a stable relay loopback port + its agent key. */
export type HostTunnelEntry = {
  hostId: string; // primary key — matches the inventory host id
  tunnelPort: number; // relay loopback port the agent's `ssh -R` binds (pool from 30000)
  agentPubkey: string; // the agent's ed25519 public key line
  createdAt: Date;
};

/** A cockpit (desktop) jump key allowed loopback-only egress on the relay. */
export type CockpitKeyEntry = {
  label: string; // primary key — a stable per-device label
  pubkey: string;
};

/**
 * Persistence for the SSH relay: per-host tunnel-port assignments plus the set of
 * cockpit jump keys. `upsert` assigns the lowest free port from the pool (>= 30000)
 * on first registration and keeps it stable thereafter (updating only the key).
 */
export interface HostTunnelStore {
  get(hostId: string): Promise<HostTunnelEntry | null>;
  /** Insert (assigning the lowest free port) or update the agent key; returns the entry. */
  upsert(hostId: string, pubkey: string): Promise<HostTunnelEntry>;
  list(): Promise<HostTunnelEntry[]>;
  addCockpitKey(label: string, pubkey: string): Promise<CockpitKeyEntry>;
  listCockpitKeys(): Promise<CockpitKeyEntry[]>;
}

export const HOST_TUNNEL_STORE = Symbol("HostTunnelStore");

/** Lowest port in the reverse-tunnel pool. */
export const TUNNEL_PORT_BASE = 30000;
