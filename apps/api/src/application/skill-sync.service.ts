import { Injectable } from "@nestjs/common";
import type { CapItem, SkillContent } from "@rcw/shared";
import { InventoryService } from "./inventory.service";
import { TelemetryService } from "./telemetry.service";
import { SkillRegistryService } from "./skill-registry.service";
import type { SkillRegistryEntry } from "../domain/skills/skill-registry.port";

/**
 * Cross-host skill auto-union. Two reconciliation triggers, both idempotent and
 * dedup-guarded so they never re-spam the same pending command:
 *
 *  - onCapsReported(host): pull unknown skills up into the registry (upload_skill)
 *    and push registry skills the host lacks down onto it (install_skill).
 *  - fanOutInstall(skill): after content lands in the registry, install it on every
 *    host whose latest caps coverage lacks that skill name.
 */
@Injectable()
export class SkillSyncService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly telemetry: TelemetryService,
    private readonly registry: SkillRegistryService,
  ) {}

  /** Does this host's latest caps coverage include a skill of this name? */
  private hostHasSkill(hostId: string, name: string): boolean {
    const caps = this.telemetry.allCaps().get(hostId);
    return !!caps?.skills.some((s) => s.name === name);
  }

  /** Is there already a pending command of this kind for this host + skill name? */
  private async alreadyQueued(hostId: string, kind: "upload_skill" | "install_skill", name: string): Promise<boolean> {
    const pending = await this.inventory.pendingCommands(hostId);
    return pending.some((c) => {
      if (c.kind !== kind) return false;
      if (kind === "upload_skill") return c.payload.name === name;
      const skill = c.payload.skill as { name?: string } | undefined;
      return skill?.name === name;
    });
  }

  /** Reconcile a host against the union when it reports its caps. Never throws. */
  async onCapsReported(hostId: string, skills: CapItem[]): Promise<void> {
    try {
      const reported = new Set(skills.map((s) => s.name));

      // Up: any reported skill the registry has no content for → ask this host to upload it.
      for (const s of skills) {
        if (!s.name) continue;
        if (await this.registry.get(s.name)) continue; // already have content — don't re-ask
        if (await this.alreadyQueued(hostId, "upload_skill", s.name)) continue;
        await this.inventory.enqueue(hostId, "upload_skill", { name: s.name });
      }

      // Down: any registry skill this host lacks → install it here.
      for (const entry of await this.registry.list()) {
        if (reported.has(entry.name)) continue;
        if (await this.alreadyQueued(hostId, "install_skill", entry.name)) continue;
        await this.inventory.enqueue(hostId, "install_skill", { skill: this.toContent(entry) });
      }
    } catch { /* reconciliation is best-effort — never break caps ingestion */ }
  }

  /**
   * Install a registry skill onto every host that lacks it (deduped). `force`
   * installs onto all known hosts regardless of coverage.
   */
  async fanOutInstall(entry: SkillRegistryEntry, force = false): Promise<{ enqueued: string[] }> {
    const enqueued: string[] = [];
    const hosts = await this.inventory.listHosts();
    for (const h of hosts) {
      if (!force && this.hostHasSkill(h.id, entry.name)) continue;
      if (h.id === entry.originHostId) continue; // the source already has it
      if (await this.alreadyQueued(h.id, "install_skill", entry.name)) continue;
      await this.inventory.enqueue(h.id, "install_skill", { skill: this.toContent(entry) });
      enqueued.push(h.id);
    }
    return { enqueued };
  }

  private toContent(entry: SkillRegistryEntry): SkillContent {
    return { name: entry.name, description: entry.description, source: entry.source, hash: entry.hash, files: entry.files };
  }
}
