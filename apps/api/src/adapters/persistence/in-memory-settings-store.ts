import type { SettingsStore } from "../../application/settings.service";

export class InMemorySettingsStore implements SettingsStore {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.map.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.map.set(key, value); }
}
