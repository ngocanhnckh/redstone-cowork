import { randomUUID } from "node:crypto";
import type { PushSubscription } from "@rcw/shared";
import type {
  PushSubscriptionStore,
  StoredPushSubscription,
} from "../../domain/push/push-subscription-store.port";

export class InMemoryPushSubscriptionStore implements PushSubscriptionStore {
  private byEndpoint = new Map<string, StoredPushSubscription>();

  async save(sub: PushSubscription): Promise<StoredPushSubscription> {
    const existing = this.byEndpoint.get(sub.endpoint);
    const stored: StoredPushSubscription = {
      id: existing?.id ?? randomUUID(),
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      label: sub.label ?? null,
    };
    this.byEndpoint.set(sub.endpoint, stored);
    return stored;
  }
  async list(): Promise<StoredPushSubscription[]> {
    return [...this.byEndpoint.values()];
  }
  async removeByEndpoint(endpoint: string): Promise<void> {
    this.byEndpoint.delete(endpoint);
  }
}
