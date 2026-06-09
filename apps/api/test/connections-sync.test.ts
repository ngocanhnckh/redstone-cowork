import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { ConnectionsService } from "../src/application/connections.service";
import { SyncService } from "../src/application/sync.service";
import { CredentialCipher } from "../src/infrastructure/credential-cipher";
import { InMemoryConnectionStore } from "../src/adapters/persistence/in-memory-connection-store";
import { InMemoryIngestedEventStore } from "../src/adapters/persistence/in-memory-ingested-event-store";
import type { Connector } from "../src/domain/integrations/connector.port";

// A deterministic fake connector that records the token it was given.
const fakeConnector = (): Connector & { seenToken?: string } => {
  const c = {
    kind: "jira" as const,
    seenToken: undefined as string | undefined,
    async validate() {
      return { ok: true };
    },
    async pull(cfg: { token: string }) {
      c.seenToken = cfg.token;
      return {
        events: [
          { source: "jira", sourceId: "RCW-1", type: "jira.issue.updated", occurredAt: new Date("2026-06-09T10:00:00Z"), actor: null, payload: {}, links: [] },
        ],
        cursor: { updatedSince: "2026-06-09 10:00" },
      };
    },
  };
  return c;
};

const setup = () => {
  const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
  const connStore = new InMemoryConnectionStore();
  const eventStore = new InMemoryIngestedEventStore();
  const connector = fakeConnector();
  const connections = new ConnectionsService(connStore, [connector], cipher);
  const sync = new SyncService(connStore, eventStore, [connector], cipher);
  return { cipher, connStore, eventStore, connector, connections, sync };
};

const newConn = { kind: "jira", endpoint: "https://jira.example", token: "secret-pat" };

describe("ConnectionsService + SyncService", () => {
  it("create validates, encrypts the token (never stored plaintext), returns a secret-free view", async () => {
    const { connections, connStore } = setup();
    const pub = await connections.create(newConn);
    expect(pub).not.toHaveProperty("secretCipher");
    expect(pub).not.toHaveProperty("token");
    const rec = (await connStore.list())[0];
    expect(rec.secretCipher).not.toContain("secret-pat");
  });

  it("create rejects when the credential vault key is missing", async () => {
    const { connStore } = setup();
    const noKey = new ConnectionsService(connStore, [fakeConnector()], new CredentialCipher(undefined));
    await expect(noKey.create(newConn)).rejects.toThrow(/CRED_ENCRYPTION_KEY/);
  });

  it("syncOne decrypts the token, ingests events, advances the cursor, marks connected", async () => {
    const { connections, connStore, sync, connector } = setup();
    const pub = await connections.create(newConn);
    const r = await sync.syncOne(pub.id);
    expect(r.inserted).toBe(1);
    expect(connector.seenToken).toBe("secret-pat"); // decrypted correctly
    const rec = await connStore.get(pub.id);
    expect(rec!.cursor.updatedSince).toBe("2026-06-09 10:00");
    expect(rec!.status).toBe("connected");
  });

  it("re-syncing ingests no duplicates (idempotent)", async () => {
    const { connections, sync } = setup();
    const pub = await connections.create(newConn);
    expect((await sync.syncOne(pub.id)).inserted).toBe(1);
    expect((await sync.syncOne(pub.id)).inserted).toBe(0); // same event, deduped
  });

  it("disconnect hard-deletes the connection (erasing the secret)", async () => {
    const { connections, connStore } = setup();
    const pub = await connections.create(newConn);
    await connections.disconnect(pub.id);
    expect(await connStore.get(pub.id)).toBeNull();
  });
});
