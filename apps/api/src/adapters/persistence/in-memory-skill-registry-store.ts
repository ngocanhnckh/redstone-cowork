import type { SkillRegistryEntry, SkillRegistryStore } from "../../domain/skills/skill-registry.port";

export class InMemorySkillRegistryStore implements SkillRegistryStore {
  private readonly byName = new Map<string, SkillRegistryEntry>();

  async get(name: string): Promise<SkillRegistryEntry | null> {
    return this.byName.get(name) ?? null;
  }
  async list(): Promise<SkillRegistryEntry[]> {
    return [...this.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async upsert(entry: SkillRegistryEntry): Promise<SkillRegistryEntry> {
    this.byName.set(entry.name, entry);
    return entry;
  }
}
