import type { Server } from "@rcw/shared";
import type { ServerStore, NewServerRecord } from "../../domain/servers/server-store.port";

type Row = NewServerRecord & { keyInstalled: boolean };

export class InMemoryServerStore implements ServerStore {
  private rows = new Map<string, Row>();
  private acl = new Set<string>(); // `${serverId}\0${accountId}`
  private usernames = new Map<string, string>(); // accountId → username (for access display)

  constructor(private readonly resolveUsername?: (accountId: string) => Promise<string | null>) {}

  private toServer(r: Row): Server {
    return { ...r, keyInstalled: r.keyInstalled };
  }
  private key(serverId: string, accountId: string): string {
    return `${serverId}\0${accountId}`;
  }

  async create(rec: NewServerRecord): Promise<Server> {
    const row: Row = { ...rec, keyInstalled: false };
    this.rows.set(rec.id, row);
    return this.toServer(row);
  }
  async get(id: string): Promise<Server | null> {
    const r = this.rows.get(id);
    return r ? this.toServer(r) : null;
  }
  async listAll(): Promise<Server[]> {
    return [...this.rows.values()].map((r) => this.toServer(r)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listForAccount(accountId: string): Promise<Server[]> {
    return [...this.rows.values()]
      .filter((r) => r.ownerAccountId === accountId || (r.ownerAccountId === null && this.acl.has(this.key(r.id, accountId))))
      .map((r) => this.toServer(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async update(id: string, patch: Partial<Row>): Promise<Server | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return this.toServer(r);
  }
  async remove(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
  async grant(serverId: string, accountId: string): Promise<void> {
    this.acl.add(this.key(serverId, accountId));
  }
  async revoke(serverId: string, accountId: string): Promise<void> {
    this.acl.delete(this.key(serverId, accountId));
  }
  async accessUsernames(serverId: string): Promise<string[]> {
    const ids = [...this.acl].filter((k) => k.startsWith(serverId + "\0")).map((k) => k.split("\0")[1]);
    const names = await Promise.all(ids.map(async (id) => (this.resolveUsername ? await this.resolveUsername(id) : id) ?? id));
    return names.sort();
  }
  async canAccess(serverId: string, accountId: string): Promise<boolean> {
    const r = this.rows.get(serverId);
    if (!r) return false;
    return r.ownerAccountId === accountId || this.acl.has(this.key(serverId, accountId));
  }
}
