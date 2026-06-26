export type DeviceRecord = {
  id: string; tokenHash: string; label: string;
  createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null;
};
export interface DeviceTokenStore {
  create(rec: DeviceRecord): Promise<DeviceRecord>;
  listActive(): Promise<DeviceRecord[]>;
  findByHash(tokenHash: string): Promise<DeviceRecord | null>;
  touch(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<boolean>;
}
export const DEVICE_TOKEN_STORE = Symbol("DeviceTokenStore");
