import type { PushSender, PushSendResult } from "../../domain/push/push-sender.port";

/**
 * Used when VAPID keys aren't configured (and in tests). Push is simply disabled:
 * publicKey() is null so the web hides the enable button, and sends are no-ops.
 */
export class NoopPushSender implements PushSender {
  publicKey(): string | null {
    return null;
  }
  async send(): Promise<PushSendResult> {
    return "ok";
  }
}
