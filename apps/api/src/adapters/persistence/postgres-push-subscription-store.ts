import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PushSubscription } from "@rcw/shared";
import type {
  PushSubscriptionStore,
  StoredPushSubscription,
} from "../../domain/push/push-subscription-store.port";

const ROW = `id, endpoint, p256dh, auth, label`;

export class PostgresPushSubscriptionStore implements PushSubscriptionStore {
  constructor(private readonly pool: Pool) {}

  async save(sub: PushSubscription): Promise<StoredPushSubscription> {
    const { rows } = await this.pool.query(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, label)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = EXCLUDED.label, last_used_at = now()
       RETURNING ${ROW}`,
      [randomUUID(), sub.endpoint, sub.keys.p256dh, sub.keys.auth, sub.label ?? null],
    );
    return rows[0];
  }
  async list(): Promise<StoredPushSubscription[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM push_subscriptions`);
    return rows;
  }
  async removeByEndpoint(endpoint: string): Promise<void> {
    await this.pool.query(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [endpoint]);
  }
}
