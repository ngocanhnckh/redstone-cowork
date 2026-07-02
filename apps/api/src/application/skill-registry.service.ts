import { Inject, Injectable } from "@nestjs/common";
import type { SkillContent } from "@rcw/shared";
import { SKILL_REGISTRY_STORE, type SkillRegistryEntry, type SkillRegistryStore } from "../domain/skills/skill-registry.port";

/**
 * The canonical, persisted union of every skill seen across the fleet. Thin wrapper
 * over the store port; the actual reconciliation/fan-out lives in SkillSyncService.
 */
@Injectable()
export class SkillRegistryService {
  constructor(@Inject(SKILL_REGISTRY_STORE) private readonly store: SkillRegistryStore) {}

  get(name: string): Promise<SkillRegistryEntry | null> { return this.store.get(name); }
  list(): Promise<SkillRegistryEntry[]> { return this.store.list(); }

  /** Upsert a skill's content into the registry (from a host upload or an org push). */
  async upsert(content: SkillContent, originHostId: string | null): Promise<SkillRegistryEntry> {
    return this.store.upsert({
      name: content.name,
      description: content.description ?? null,
      source: content.source,
      hash: content.hash,
      files: content.files,
      originHostId,
      updatedAt: new Date(),
    });
  }
}
