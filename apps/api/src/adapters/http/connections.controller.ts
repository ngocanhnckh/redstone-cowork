import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { ConnectionsService } from "../../application/connections.service";
import { SyncService } from "../../application/sync.service";
import { INGESTED_EVENT_STORE, type IngestedEventStore } from "../../domain/integrations/ingested-event-store.port";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller()
@UseGuards(InstanceTokenGuard)
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly sync: SyncService,
    @Inject(INGESTED_EVENT_STORE) private readonly events: IngestedEventStore,
  ) {}

  @Get("connections")
  list() {
    return this.connections.list();
  }

  @Post("connections")
  @HttpCode(201)
  async create(@Body() body: unknown) {
    try {
      return await this.connections.create(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Delete("connections/:id")
  @HttpCode(200)
  async remove(@Param("id") id: string) {
    await this.connections.disconnect(id);
    return { ok: true };
  }

  @Post("connections/:id/sync")
  @HttpCode(200)
  syncOne(@Param("id") id: string) {
    return this.sync.syncOne(id);
  }

  @Post("connections/sync-due")
  @HttpCode(200)
  syncDue() {
    return this.sync.syncDue();
  }

  @Get("events/recent")
  recent(@Query("limit") limit = "50") {
    return this.events.recent(Math.min(Number(limit) || 50, 200));
  }
}
