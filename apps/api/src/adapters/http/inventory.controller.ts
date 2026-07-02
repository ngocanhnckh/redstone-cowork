import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z, ZodError } from "zod";
import { InventoryService } from "../../application/inventory.service";
import { ExternalApiGuard } from "./external-api.guard";
import type { GuardedRequest } from "./instance-token.guard";

/**
 * The consumer surface: browse all discovered sessions grouped by host → folder,
 * read a session's history, tag it, or send a passive one-shot message. Guarded;
 * also reachable by external callers via an access key (see access-key auth kind).
 */
@Controller("inventory")
@UseGuards(ExternalApiGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  async list(
    @Query("host") host?: string,
    @Query("folder") folder?: string,
    @Query("tag") tag?: string,
    @Query("source") source?: string,
  ) {
    const [hosts, sessions] = await Promise.all([
      this.inventory.listHosts(),
      this.inventory.list({ hostId: host, folder, tag, source }),
    ]);
    return { hosts, sessions };
  }

  @Get(":id/history")
  async history(@Param("id") id: string) {
    return this.inventory.requestHistory(id);
  }

  @Post(":id/run")
  @HttpCode(200)
  async run(@Param("id") id: string, @Body() body: unknown, @Req() request: GuardedRequest) {
    try {
      // Sending a message is a control action — an access key needs `control` scope.
      if (request.authKind === "accesskey" && request.accessScope !== "control") {
        throw new ForbiddenException("this access key is read-only (needs 'control' scope)");
      }
      const { message } = z.object({ message: z.string().min(1) }).parse(body);
      return await this.inventory.requestRun(id, message);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/tags")
  @HttpCode(201)
  async addTag(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { tag } = z.object({ tag: z.string().min(1) }).parse(body);
      const updated = await this.inventory.addTag(id, tag);
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/tags/remove")
  @HttpCode(200)
  async removeTag(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { tag } = z.object({ tag: z.string().min(1) }).parse(body);
      const updated = await this.inventory.removeTag(id, tag);
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}
