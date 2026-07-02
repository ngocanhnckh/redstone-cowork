import type { Host, DiscoveredSession, ScannedSession, HostCommand } from "@rcw/shared";
import type { InventoryStore } from "../../domain/inventory/inventory-store.port";

const folderOf = (cwd: string): string => cwd.split("/").filter(Boolean).pop() ?? cwd;

export class InMemoryInventoryStore implements InventoryStore {
  private hosts = new Map<string, Host>();
  private discovered = new Map<string, DiscoveredSession>();
  private commands = new Map<string, HostCommand>();

  async upsertHost(input: { id: string; machine: string; user: string | null; os: string | null; at: Date }): Promise<Host> {
    const existing = this.hosts.get(input.id);
    const host: Host = {
      id: input.id,
      machine: input.machine,
      user: input.user,
      os: input.os,
      lastSeenAt: input.at,
      createdAt: existing?.createdAt ?? input.at,
    };
    this.hosts.set(host.id, host);
    return host;
  }
  async touchHost(id: string, at: Date): Promise<void> {
    const h = this.hosts.get(id);
    if (h) h.lastSeenAt = at;
  }
  async listHosts(): Promise<Host[]> {
    return [...this.hosts.values()].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  async reportInventory(hostId: string, machine: string, sessions: ScannedSession[], coworkIds: Set<string>, at: Date): Promise<void> {
    for (const s of sessions) {
      const existing = this.discovered.get(s.id);
      this.discovered.set(s.id, {
        id: s.id,
        hostId,
        machine,
        cwd: s.cwd,
        folder: folderOf(s.cwd),
        title: s.title ?? existing?.title ?? null,
        lastActive: s.lastActive,
        messageCount: s.messageCount,
        sizeBytes: s.sizeBytes,
        source: coworkIds.has(s.id) ? "cowork" : "external",
        tags: existing?.tags ?? [], // tags are user data — preserve across rescans
        updatedAt: at,
      });
    }
  }
  async listDiscovered(filter?: { hostId?: string; folder?: string; tag?: string; source?: string }): Promise<DiscoveredSession[]> {
    let out = [...this.discovered.values()];
    if (filter?.hostId) out = out.filter((d) => d.hostId === filter.hostId);
    if (filter?.folder) out = out.filter((d) => d.folder === filter.folder);
    if (filter?.source) out = out.filter((d) => d.source === filter.source);
    if (filter?.tag) out = out.filter((d) => d.tags.some((t) => t.toLowerCase() === filter.tag!.toLowerCase()));
    return out.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
  }
  async getDiscovered(id: string): Promise<DiscoveredSession | null> {
    return this.discovered.get(id) ?? null;
  }
  async setTags(id: string, tags: string[]): Promise<DiscoveredSession | null> {
    const d = this.discovered.get(id);
    if (!d) return null;
    const next = { ...d, tags };
    this.discovered.set(id, next);
    return next;
  }

  async enqueueCommand(cmd: HostCommand): Promise<HostCommand> {
    this.commands.set(cmd.id, cmd);
    return cmd;
  }
  async listPendingCommands(hostId: string): Promise<HostCommand[]> {
    return [...this.commands.values()].filter((c) => c.hostId === hostId && c.status === "pending");
  }
  async completeCommand(id: string, result: Record<string, unknown>): Promise<HostCommand | null> {
    const c = this.commands.get(id);
    if (!c) return null;
    const next: HostCommand = { ...c, status: "done", result };
    this.commands.set(id, next);
    return next;
  }
  async getCommand(id: string): Promise<HostCommand | null> {
    return this.commands.get(id) ?? null;
  }
}
