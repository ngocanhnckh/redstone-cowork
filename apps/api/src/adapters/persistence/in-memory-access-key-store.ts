import type { AccessKey } from "@rcw/shared";
import type { AccessKeyStore, NewAccessKeyRecord } from "../../domain/access-keys/access-key-store.port";

type Row = AccessKey & { keyHash: string };

export class InMemoryAccessKeyStore implements AccessKeyStore {
  private byId = new Map<string, Row>();

  async create(rec: NewAccessKeyRecord): Promise<AccessKey> {
    const row: Row = {
      id: rec.id, name: rec.name, keyHash: rec.keyHash, prefix: rec.prefix, scope: rec.scope,
      createdAt: rec.createdAt, lastUsedAt: null, revokedAt: null,
    };
    this.byId.set(row.id, row);
    return this.strip(row);
  }
  async findByHash(keyHash: string): Promise<AccessKey | null> {
    for (const r of this.byId.values()) if (r.keyHash === keyHash) return this.strip(r);
    return null;
  }
  async list(): Promise<AccessKey[]> {
    return [...this.byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => this.strip(r));
  }
  async revoke(id: string, at: Date): Promise<boolean> {
    const r = this.byId.get(id);
    if (!r) return false;
    r.revokedAt = at;
    return true;
  }
  async touch(id: string, at: Date): Promise<void> {
    const r = this.byId.get(id);
    if (r) r.lastUsedAt = at;
  }
  private strip(r: Row): AccessKey {
    const { keyHash: _omit, ...meta } = r;
    void _omit;
    return { ...meta };
  }
}
