import { Inject, Injectable } from "@nestjs/common";

export interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
export const SETTINGS_STORE = Symbol("SettingsStore");

export const REDSTONE_OWNER_SUB = "redstone_owner_sub";

/** Instance-level key/value settings (persisted). */
@Injectable()
export class SettingsService {
  constructor(@Inject(SETTINGS_STORE) private readonly store: SettingsStore) {}
  get(key: string): Promise<string | null> { return this.store.get(key); }
  set(key: string, value: string): Promise<void> { return this.store.set(key, value); }

  /** The linked Redstone owner's `sub`, recorded at first org login (null until then). */
  ownerSub(): Promise<string | null> { return this.store.get(REDSTONE_OWNER_SUB); }
  /** Record the owner on first login; no-op if already set (first linker wins). */
  async claimOwnerIfUnset(sub: string): Promise<void> {
    if (!(await this.store.get(REDSTONE_OWNER_SUB))) await this.store.set(REDSTONE_OWNER_SUB, sub);
  }
}
