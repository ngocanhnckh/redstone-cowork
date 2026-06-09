import type { StoredPushSubscription } from "./push-subscription-store.port";

/** Result of a single send: "gone" means the subscription is dead (404/410) and should be pruned. */
export type PushSendResult = "ok" | "gone" | "error";

export interface PushSender {
  send(sub: StoredPushSubscription, payload: string): Promise<PushSendResult>;
  /** The VAPID public key the browser needs to subscribe, or null when push isn't configured. */
  publicKey(): string | null;
}
export const PUSH_SENDER = Symbol("PushSender");
