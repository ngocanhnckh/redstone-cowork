import { Module } from "@nestjs/common";
import { HealthController } from "./adapters/http/health.controller";
import { EventsController } from "./adapters/http/events.controller";
import { RecordEventUseCase } from "./application/record-event.use-case";
import { EVENT_STORE } from "./domain/events/event-store.port";
import { InMemoryEventStore } from "./adapters/persistence/in-memory-event-store";
import { PostgresEventStore } from "./adapters/persistence/postgres-event-store";
import { createPool } from "./infrastructure/db";
import { loadConfig } from "./infrastructure/config";

@Module({
  controllers: [HealthController, EventsController],
  providers: [
    RecordEventUseCase,
    {
      provide: EVENT_STORE,
      useFactory: () => {
        const { DATABASE_URL } = loadConfig();
        return DATABASE_URL ? new PostgresEventStore(createPool(DATABASE_URL)) : new InMemoryEventStore();
      },
    },
  ],
})
export class AppModule {}
