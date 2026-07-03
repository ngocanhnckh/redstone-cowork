import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";
import {
  ClaudeConfigNameSchema,
  ClaudeConfigUpsertSchema,
  type ClaudeConfigProfile,
} from "@rcw/shared";
import { ClaudeConfigService } from "../../application/claude-config.service";
import { ExternalApiGuard } from "./external-api.guard";

/**
 * Named Claude endpoint config profiles. The host agent CLI fetches a profile by
 * name over the authed channel and injects its env into a Claude session. Shares
 * the ExternalApiGuard so agent/device/instance/redstone tokens all work. The list
 * surface returns names only — secret values never appear in it.
 */
@Controller("configs")
@UseGuards(ExternalApiGuard)
export class ClaudeConfigsController {
  constructor(private readonly configs: ClaudeConfigService) {}

  /** All profile names (never leaks env values). */
  @Get()
  async list(): Promise<{ name: string }[]> {
    return this.configs.list();
  }

  /** A single profile with its decrypted env map (404 if unknown). */
  @Get(":name")
  async get(@Param("name") name: string): Promise<ClaudeConfigProfile> {
    const parsed = this.parseName(name);
    const profile = await this.configs.get(parsed);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  /** Upsert a profile's env map. */
  @Put(":name")
  @HttpCode(200)
  async upsert(@Param("name") name: string, @Body() body: unknown): Promise<{ ok: true }> {
    const parsed = this.parseName(name);
    try {
      const { env } = ClaudeConfigUpsertSchema.parse(body);
      await this.configs.upsert(parsed, env);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Delete(":name")
  async remove(@Param("name") name: string): Promise<{ ok: true }> {
    const parsed = this.parseName(name);
    await this.configs.remove(parsed);
    return { ok: true };
  }

  private parseName(name: string): string {
    try {
      return ClaudeConfigNameSchema.parse(name);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}
