import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { ZodError } from "zod";
import { createHash } from "node:crypto";
import { SkillPushBodySchema, type SkillContent, type SkillFile, type SkillListItem } from "@rcw/shared";
import { InventoryService } from "../../application/inventory.service";
import { TelemetryService } from "../../application/telemetry.service";
import { SkillRegistryService } from "../../application/skill-registry.service";
import { SkillSyncService } from "../../application/skill-sync.service";
import { ExternalApiGuard } from "./external-api.guard";

/** Stable content hash over sorted file paths + contents (mirrors the agent's). */
function hashFiles(files: SkillFile[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path, "utf8"); h.update("\0", "utf8");
    h.update(f.content, "utf8"); h.update("\0", "utf8");
  }
  return h.digest("hex");
}

/**
 * Skill distribution surface for an org system (redstone-agent): view the union
 * skill list + fleet coverage, and push a brand-new skill to every host at once.
 * Shares the ExternalApiGuard so access-keys + device/instance/redstone tokens work.
 */
@Controller("skills")
@UseGuards(ExternalApiGuard)
export class SkillsController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly telemetry: TelemetryService,
    private readonly registry: SkillRegistryService,
    private readonly skillSync: SkillSyncService,
  ) {}

  /** The union skill list: each skill + which hosts currently have it (from caps coverage). */
  @Get()
  async list(): Promise<SkillListItem[]> {
    const hosts = await this.inventory.listHosts();
    const totalHosts = hosts.length;
    const coverage = this.telemetry.allCaps(); // hostId -> { skills }
    const byName = new Map<string, SkillListItem>();

    const ensure = (name: string): SkillListItem =>
      byName.get(name) ?? byName.set(name, { name, description: null, source: "personal", hash: null, hosts: [], present: 0, totalHosts }).get(name)!;

    // Coverage: which hosts currently report each skill name.
    for (const [hostId, entry] of coverage) {
      for (const s of entry.skills) {
        const item = ensure(s.name);
        if (!item.hosts.includes(hostId)) { item.hosts.push(hostId); item.present = item.hosts.length; }
        if (!item.description && s.description) item.description = s.description;
        if (s.source) item.source = s.source;
      }
    }
    // Registry entries (canonical metadata; may include skills not on any host yet).
    for (const e of await this.registry.list()) {
      const item = ensure(e.name);
      item.description = e.description ?? item.description;
      item.source = e.source ?? item.source;
      item.hash = e.hash;
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Org pushes a new/updated skill to the whole fleet. */
  @Post()
  @HttpCode(200)
  async push(@Body() body: unknown) {
    try {
      const { name, description, files, force } = SkillPushBodySchema.parse(body);
      const content: SkillContent = {
        name,
        description: description ?? null,
        source: "org",
        hash: hashFiles(files),
        files,
      };
      const entry = await this.registry.upsert(content, null);
      const { enqueued } = await this.skillSync.fanOutInstall(entry, force ?? false);
      return { skill: content, installing: enqueued.length };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}
