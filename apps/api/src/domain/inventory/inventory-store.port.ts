import type { Host, DiscoveredSession, ScannedSession, HostCommand, HostCommandKind } from "@rcw/shared";

/** Persistence for the session inventory: hosts, discovered sessions, host commands. */
export interface InventoryStore {
  // Hosts
  upsertHost(input: { id: string; machine: string; user: string | null; os: string | null; address: string | null; sshPort: number | null; at: Date }): Promise<Host>;
  touchHost(id: string, at: Date): Promise<void>;
  listHosts(): Promise<Host[]>;

  // Discovered sessions — `reportInventory` upserts a host's full snapshot.
  reportInventory(hostId: string, machine: string, sessions: ScannedSession[], coworkIds: Set<string>, at: Date): Promise<void>;
  listDiscovered(filter?: { hostId?: string; folder?: string; tag?: string; source?: string }): Promise<DiscoveredSession[]>;
  getDiscovered(id: string): Promise<DiscoveredSession | null>;
  setTags(id: string, tags: string[]): Promise<DiscoveredSession | null>;

  // Host command queue
  enqueueCommand(cmd: HostCommand): Promise<HostCommand>;
  listPendingCommands(hostId: string): Promise<HostCommand[]>;
  completeCommand(id: string, result: Record<string, unknown>): Promise<HostCommand | null>;
  getCommand(id: string): Promise<HostCommand | null>;
}

export const INVENTORY_STORE = Symbol("InventoryStore");
export type { HostCommandKind };
