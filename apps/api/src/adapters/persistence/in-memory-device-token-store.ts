import type { DeviceRecord, DeviceTokenStore } from "../../domain/devices/device-token-store.port";

export class InMemoryDeviceTokenStore implements DeviceTokenStore {
  private readonly map = new Map<string, DeviceRecord>();

  async create(rec: DeviceRecord): Promise<DeviceRecord> {
    this.map.set(rec.id, { ...rec });
    return { ...rec };
  }

  async listActive(): Promise<DeviceRecord[]> {
    return Array.from(this.map.values())
      .filter((r) => r.revokedAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findByHash(tokenHash: string): Promise<DeviceRecord | null> {
    for (const rec of this.map.values()) {
      if (rec.tokenHash === tokenHash) return { ...rec };
    }
    return null;
  }

  async touch(id: string, at: Date): Promise<void> {
    const rec = this.map.get(id);
    if (rec) rec.lastSeenAt = at;
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const rec = this.map.get(id);
    if (!rec || rec.revokedAt !== null) return false;
    rec.revokedAt = at;
    return true;
  }
}
