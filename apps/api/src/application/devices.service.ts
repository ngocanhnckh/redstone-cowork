import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Device, MintedDevice } from "@rcw/shared";
import { DEVICE_TOKEN_STORE, type DeviceRecord, type DeviceTokenStore } from "../domain/devices/device-token-store.port";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const toPublic = (r: DeviceRecord): Device => ({ id: r.id, label: r.label, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, revokedAt: r.revokedAt });

@Injectable()
export class DevicesService {
  constructor(@Inject(DEVICE_TOKEN_STORE) private readonly store: DeviceTokenStore) {}
  async mint(label: string): Promise<MintedDevice> {
    const token = "rcwd_" + randomBytes(24).toString("base64url");
    const rec = await this.store.create({ id: randomUUID(), tokenHash: sha256(token), label, createdAt: new Date(), lastSeenAt: null, revokedAt: null });
    return { ...toPublic(rec), token };
  }
  async list(): Promise<Device[]> { return (await this.store.listActive()).map(toPublic); }
  revoke(id: string): Promise<boolean> { return this.store.revoke(id, new Date()); }
  async verify(token: string): Promise<{ id: string } | null> {
    if (!token.startsWith("rcwd_")) return null;
    const rec = await this.store.findByHash(sha256(token));
    if (!rec || rec.revokedAt) return null;
    await this.store.touch(rec.id, new Date());
    return { id: rec.id };
  }
}
