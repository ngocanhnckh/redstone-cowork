import type { ConnectionStore, ConnectionRecord } from "../../domain/integrations/connection-store.port";

export class InMemoryConnectionStore implements ConnectionStore {
  private map = new Map<string, ConnectionRecord>();
  async create(rec: ConnectionRecord) { this.map.set(rec.id, rec); return rec; }
  async list() { return [...this.map.values()]; }
  async get(id: string) { return this.map.get(id) ?? null; }
  async updateSync(id: string, patch: Pick<ConnectionRecord, "cursor" | "status" | "lastError" | "lastSyncAt">) {
    const rec = this.map.get(id);
    if (rec) this.map.set(id, { ...rec, ...patch });
  }
  async delete(id: string) { this.map.delete(id); }
}
