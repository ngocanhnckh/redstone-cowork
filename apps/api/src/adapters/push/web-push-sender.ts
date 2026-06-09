import webpush from "web-push";
import type { PushSender, PushSendResult } from "../../domain/push/push-sender.port";
import type { StoredPushSubscription } from "../../domain/push/push-subscription-store.port";

/**
 * Signs and delivers Web Push messages with VAPID. The browser's own push
 * service (Apple/Google/Mozilla) does the delivery — no third-party push
 * provider, which keeps the instance self-hosted.
 */
export class WebPushSender implements PushSender {
  constructor(
    private readonly vapidPublic: string,
    vapidPrivate: string,
    subject: string,
  ) {
    webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);
  }

  publicKey(): string | null {
    return this.vapidPublic;
  }

  async send(sub: StoredPushSubscription, payload: string): Promise<PushSendResult> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      return "ok";
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone"; // expired/unsubscribed → prune
      return "error";
    }
  }
}
