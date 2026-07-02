import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { z, ZodError } from "zod";
import { SkillContentSchema } from "@rcw/shared";
import { InventoryService } from "../../application/inventory.service";
import { TelemetryService } from "../../application/telemetry.service";
import { SkillRegistryService } from "../../application/skill-registry.service";
import { SkillSyncService } from "../../application/skill-sync.service";
import { ExternalApiGuard } from "./external-api.guard";

/**
 * The host-agent surface: the `redstone agent` daemon registers its machine,
 * reports the sessions it scanned, long-polls for commands, and posts results.
 * Authenticated like the rest of the CLI (instance token / access key).
 */
@Controller("hosts")
@UseGuards(ExternalApiGuard)
export class HostsController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly telemetry: TelemetryService,
    private readonly registry: SkillRegistryService,
    private readonly skillSync: SkillSyncService,
  ) {}

  @Post(":id/telemetry")
  @HttpCode(200)
  async reportTelemetry(@Param("id") id: string, @Body() body: unknown) {
    try {
      this.telemetry.record(id, body);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/docker")
  @HttpCode(200)
  async reportDocker(@Param("id") id: string, @Body() body: unknown) {
    try {
      this.telemetry.recordDocker(id, body);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/caps")
  @HttpCode(200)
  async reportCaps(@Param("id") id: string, @Body() body: unknown) {
    try {
      this.telemetry.recordCaps(id, body);
      // Reconcile this host against the cross-host union (best-effort, never throws).
      const skills = this.telemetry.allCaps().get(id)?.skills ?? [];
      await this.skillSync.onCapsReported(id, skills);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  /** Agent uploads a skill's full contents (in response to an upload_skill command). */
  @Post(":id/skills")
  @HttpCode(200)
  async uploadSkill(@Param("id") id: string, @Body() body: unknown) {
    try {
      const content = SkillContentSchema.parse(body);
      const entry = await this.registry.upsert(content, id);
      const { enqueued } = await this.skillSync.fanOutInstall(entry);
      return { ok: true, name: entry.name, installing: enqueued.length };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post()
  @HttpCode(200)
  async register(@Body() body: unknown) {
    try {
      return await this.inventory.registerHost(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  /** All known hosts (incl. reachable address) — lets clients auto-resolve SSH targets. */
  @Get()
  async list() {
    return this.inventory.listHosts();
  }

  @Post(":id/inventory")
  @HttpCode(200)
  async report(@Param("id") id: string, @Body() body: unknown) {
    try {
      await this.inventory.reportInventory(id, body);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get(":id/commands")
  async commands(@Param("id") id: string, @Query("timeoutMs") timeoutMs = "25000", @Res() res: Response) {
    const items = await this.inventory.pollCommands(id, Number(timeoutMs) || 25_000);
    if (items.length === 0) return res.status(204).send();
    return res.status(200).json(items);
  }

  @Post(":id/commands/:cmdId/result")
  @HttpCode(200)
  async result(@Param("cmdId") cmdId: string, @Body() body: unknown) {
    const result = z.record(z.unknown()).parse(body ?? {});
    if (!(await this.inventory.completeCommand(cmdId, result))) throw new NotFoundException();
    return { ok: true };
  }
}
