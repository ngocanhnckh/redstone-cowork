import {
  TUNNEL_PORT_BASE,
  type CockpitKeyEntry,
  type HostTunnelEntry,
  type HostTunnelStore,
} from "../../domain/tunnels/host-tunnel.port";

export class InMemoryHostTunnelStore implements HostTunnelStore {
  private readonly byHost = new Map<string, HostTunnelEntry>();
  private readonly cockpitKeys = new Map<string, CockpitKeyEntry>();

  async get(hostId: string): Promise<HostTunnelEntry | null> {
    return this.byHost.get(hostId) ?? null;
  }

  async list(): Promise<HostTunnelEntry[]> {
    return [...this.byHost.values()].sort((a, b) => a.tunnelPort - b.tunnelPort);
  }

  async upsert(hostId: string, pubkey: string): Promise<HostTunnelEntry> {
    const existing = this.byHost.get(hostId);
    if (existing) {
      const updated = { ...existing, agentPubkey: pubkey };
      this.byHost.set(hostId, updated);
      return updated;
    }
    const used = new Set([...this.byHost.values()].map((e) => e.tunnelPort));
    let port = TUNNEL_PORT_BASE;
    while (used.has(port)) port++;
    const entry: HostTunnelEntry = { hostId, tunnelPort: port, agentPubkey: pubkey, createdAt: new Date() };
    this.byHost.set(hostId, entry);
    return entry;
  }

  async addCockpitKey(label: string, pubkey: string): Promise<CockpitKeyEntry> {
    const entry: CockpitKeyEntry = { label, pubkey };
    this.cockpitKeys.set(label, entry);
    return entry;
  }

  async listCockpitKeys(): Promise<CockpitKeyEntry[]> {
    return [...this.cockpitKeys.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
}
