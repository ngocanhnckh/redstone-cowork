import type { PushSubscription } from "@rcw/shared";

/** A stored push subscription (browser PushSubscription JSON, flattened). */
export type StoredPushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string | null;
};

export interface PushSubscriptionStore {
  /** Upsert by endpoint — re-subscribing the same device updates its keys. */
  save(sub: PushSubscription): Promise<StoredPushSubscription>;
  list(): Promise<StoredPushSubscription[]>;
  removeByEndpoint(endpoint: string): Promise<void>;
}
export const PUSH_SUBSCRIPTION_STORE = Symbol("PushSubscriptionStore");
