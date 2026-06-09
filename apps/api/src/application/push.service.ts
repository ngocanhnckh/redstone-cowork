import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { PushSubscriptionSchema, type Decision } from "@rcw/shared";
import {
  PUSH_SUBSCRIPTION_STORE,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "../domain/push/push-subscription-store.port";
import { PUSH_SENDER, type PushSender } from "../domain/push/push-sender.port";
import { EventsBus } from "./events-bus";

// Kinds worth waking the phone for. Completions are passive noise; skip them.
const PUSH_KINDS = new Set(["question", "permission", "notification"]);

@Injectable()
export class PushService implements OnModuleInit {
  constructor(
    @Inject(PUSH_SUBSCRIPTION_STORE) private readonly store: PushSubscriptionStore,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    private readonly bus: EventsBus,
  ) {}

  onModuleInit(): void {
    this.bus.stream$.subscribe((e) => {
      if (e.type !== "decision.created") return;
      const decision = e.payload as Decision;
      if (!PUSH_KINDS.has(decision.kind)) return;
      void this.notify(decision);
    });
  }

  vapidPublicKey(): string | null {
    return this.sender.publicKey();
  }

  register(input: unknown) {
    return this.store.save(PushSubscriptionSchema.parse(input));
  }
  remove(endpoint: string) {
    return this.store.removeByEndpoint(endpoint);
  }

  /** Fan a decision out to every registered device; prune any that are gone. */
  async notify(decision: Decision): Promise<void> {
    const payload = JSON.stringify(this.payloadFor(decision));
    const subs = await this.store.list();
    await Promise.all(
      subs.map(async (sub: StoredPushSubscription) => {
        const result = await this.sender.send(sub, payload);
        if (result === "gone") await this.store.removeByEndpoint(sub.endpoint);
      }),
    );
  }

  private payloadFor(decision: Decision) {
    const title =
      decision.kind === "permission"
        ? "Claude needs permission"
        : decision.kind === "question"
          ? "Claude has a question"
          : "Redstone Cowork";
    const deliverable = (decision.body as { deliverable?: boolean } | undefined)?.deliverable !== false;
    return {
      title,
      body: decision.title,
      url: "/",
      decisionId: decision.id,
      kind: decision.kind,
      deliverable,
    };
  }
}
