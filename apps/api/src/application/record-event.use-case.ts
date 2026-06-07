import { Inject, Injectable } from "@nestjs/common";
import { NewDomainEventSchema, type DomainEvent } from "@rcw/shared";
import { randomUUID } from "node:crypto";
import { EVENT_STORE, type EventStore } from "../domain/events/event-store.port";

@Injectable()
export class RecordEventUseCase {
  constructor(@Inject(EVENT_STORE) private readonly store: EventStore) {}

  async execute(input: unknown): Promise<DomainEvent> {
    const parsed = NewDomainEventSchema.parse(input);
    const event: DomainEvent = { ...parsed, id: randomUUID(), occurredAt: new Date() };
    await this.store.append(event);
    return event;
  }
}
