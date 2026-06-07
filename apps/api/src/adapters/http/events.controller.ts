import { BadRequestException, Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { RecordEventUseCase } from "../../application/record-event.use-case";
import { EVENT_STORE, type EventStore } from "../../domain/events/event-store.port";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("events")
@UseGuards(InstanceTokenGuard)
export class EventsController {
  constructor(
    private readonly recordEvent: RecordEventUseCase,
    @Inject(EVENT_STORE) private readonly store: EventStore
  ) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.recordEvent.execute(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get()
  list() {
    return this.store.list();
  }
}
