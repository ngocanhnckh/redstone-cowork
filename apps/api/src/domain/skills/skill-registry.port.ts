import type { SkillFile } from "@rcw/shared";

/** One canonical skill in the cross-host union registry (the distribution source). */
export type SkillRegistryEntry = {
  name: string; // primary key — skill name, deduped across hosts
  description: string | null;
  source: string; // "personal" | "plugin:<name>" | "org"
  hash: string;
  files: SkillFile[];
  originHostId: string | null; // host it was first captured from, or null/"org" when pushed
  updatedAt: Date;
};

/** Persistence for the canonical union skill registry — survives restarts. */
export interface SkillRegistryStore {
  get(name: string): Promise<SkillRegistryEntry | null>;
  list(): Promise<SkillRegistryEntry[]>;
  upsert(entry: SkillRegistryEntry): Promise<SkillRegistryEntry>;
}

export const SKILL_REGISTRY_STORE = Symbol("SkillRegistryStore");
