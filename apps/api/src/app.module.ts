import { Module } from "@nestjs/common";
import { HealthController } from "./adapters/http/health.controller";
import { EventsController } from "./adapters/http/events.controller";
import { SessionsController } from "./adapters/http/sessions.controller";
import { DecisionsController } from "./adapters/http/decisions.controller";
import { StreamController } from "./adapters/http/stream.controller";
import { RecordEventUseCase } from "./application/record-event.use-case";
import { SessionsService } from "./application/sessions.service";
import { DecisionsService } from "./application/decisions.service";
import { DecisionWaiters } from "./application/decision-waiters";
import { DeliveryWaiters } from "./application/delivery-waiters";
import { EventsBus } from "./application/events-bus";
import { EVENT_STORE } from "./domain/events/event-store.port";
import { SESSION_STORE } from "./domain/sessions/session-store.port";
import { DECISION_STORE } from "./domain/decisions/decision-store.port";
import { InMemoryEventStore } from "./adapters/persistence/in-memory-event-store";
import { PostgresEventStore } from "./adapters/persistence/postgres-event-store";
import { InMemorySessionStore } from "./adapters/persistence/in-memory-session-store";
import { PostgresSessionStore } from "./adapters/persistence/postgres-session-store";
import { InMemoryDecisionStore } from "./adapters/persistence/in-memory-decision-store";
import { PostgresDecisionStore } from "./adapters/persistence/postgres-decision-store";
import { PushController } from "./adapters/http/push.controller";
import { PushService } from "./application/push.service";
import { PUSH_SUBSCRIPTION_STORE } from "./domain/push/push-subscription-store.port";
import { PUSH_SENDER } from "./domain/push/push-sender.port";
import { InMemoryPushSubscriptionStore } from "./adapters/persistence/in-memory-push-subscription-store";
import { PostgresPushSubscriptionStore } from "./adapters/persistence/postgres-push-subscription-store";
import { WebPushSender } from "./adapters/push/web-push-sender";
import { NoopPushSender } from "./adapters/push/noop-push-sender";
import { PG_POOL, pgPoolProvider, PoolShutdown } from "./infrastructure/pg-pool.provider";
import type { Pool } from "pg";

@Module({
  controllers: [HealthController, EventsController, SessionsController, DecisionsController, StreamController, PushController],
  providers: [
    RecordEventUseCase,
    SessionsService,
    DecisionsService,
    PushService,
    DecisionWaiters,
    DeliveryWaiters,
    EventsBus,
    // Single shared pool — null when DATABASE_URL is unset (tests run without DB)
    pgPoolProvider,
    // Graceful shutdown: ends the pool when the module is destroyed
    PoolShutdown,
    {
      provide: EVENT_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresEventStore(pool) : new InMemoryEventStore(),
    },
    {
      provide: SESSION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresSessionStore(pool) : new InMemorySessionStore(),
    },
    {
      provide: DECISION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresDecisionStore(pool) : new InMemoryDecisionStore(),
    },
    {
      provide: PUSH_SUBSCRIPTION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresPushSubscriptionStore(pool) : new InMemoryPushSubscriptionStore(),
    },
    {
      // Web Push when VAPID keys are configured; otherwise push is disabled (noop).
      provide: PUSH_SENDER,
      useFactory: () => {
        const pub = process.env.VAPID_PUBLIC_KEY;
        const priv = process.env.VAPID_PRIVATE_KEY;
        const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
        return pub && priv ? new WebPushSender(pub, priv, subject) : new NoopPushSender();
      },
    },
  ],
})
export class AppModule {}
