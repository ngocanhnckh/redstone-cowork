import { Inject, Injectable } from "@nestjs/common";
import { CONNECTION_STORE, type ConnectionStore } from "../domain/integrations/connection-store.port";
import { INGESTED_EVENT_STORE, type IngestedEventStore } from "../domain/integrations/ingested-event-store.port";
import { CONNECTORS, type Connector } from "../domain/integrations/connector.port";
import { CredentialCipher } from "../infrastructure/credential-cipher";

@Injectable()
export class SyncService {
  constructor(
    @Inject(CONNECTION_STORE) private readonly store: ConnectionStore,
    @Inject(INGESTED_EVENT_STORE) private readonly events: IngestedEventStore,
    @Inject(CONNECTORS) private readonly connectors: Connector[],
    private readonly cipher: CredentialCipher,
  ) {}

  /** Pull one connection, ingest idempotently, advance cursor, record status. */
  async syncOne(id: string): Promise<{ inserted: number; error?: string }> {
    const rec = await this.store.get(id);
    if (!rec) return { inserted: 0, error: "not found" };
    const connector = this.connectors.find((c) => c.kind === rec.kind);
    if (!connector) return { inserted: 0, error: `no connector for ${rec.kind}` };

    try {
      const token = this.cipher.decrypt(rec.secretCipher);
      const { events, cursor } = await connector.pull(
        { endpoint: rec.endpoint, token, config: rec.config },
        rec.cursor,
      );
      const inserted = await this.events.appendMany(events);
      await this.store.updateSync(id, { cursor, status: "connected", lastError: null, lastSyncAt: new Date() });
      return { inserted };
    } catch (e) {
      const error = e instanceof Error ? e.message : "sync failed";
      await this.store.updateSync(id, { cursor: rec.cursor, status: "erroring", lastError: error, lastSyncAt: new Date() });
      return { inserted: 0, error };
    }
  }

  /** Sync every connection that isn't disabled. */
  async syncDue(): Promise<{ synced: number; inserted: number }> {
    const conns = (await this.store.list()).filter((c) => c.status !== "disabled");
    let inserted = 0;
    for (const c of conns) inserted += (await this.syncOne(c.id)).inserted;
    return { synced: conns.length, inserted };
  }
}
