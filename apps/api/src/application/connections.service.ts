import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { NewConnectionSchema, type Connection } from "@rcw/shared";
import { CONNECTION_STORE, type ConnectionStore, type ConnectionRecord } from "../domain/integrations/connection-store.port";
import { CONNECTORS, type Connector } from "../domain/integrations/connector.port";
import { CredentialCipher } from "../infrastructure/credential-cipher";

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(CONNECTION_STORE) private readonly store: ConnectionStore,
    @Inject(CONNECTORS) private readonly connectors: Connector[],
    private readonly cipher: CredentialCipher,
  ) {}

  connectorFor(kind: string): Connector {
    const c = this.connectors.find((x) => x.kind === kind);
    if (!c) throw new BadRequestException(`unknown connector: ${kind}`);
    return c;
  }

  toPublic(rec: ConnectionRecord): Connection {
    return {
      id: rec.id, kind: rec.kind, endpoint: rec.endpoint, label: rec.label,
      status: rec.status, lastSyncAt: rec.lastSyncAt, lastError: rec.lastError, config: rec.config,
    };
  }

  async create(input: unknown): Promise<Connection> {
    if (!this.cipher.isConfigured()) {
      throw new BadRequestException("CRED_ENCRYPTION_KEY not configured on this instance");
    }
    const parsed = NewConnectionSchema.parse(input);
    const connector = this.connectorFor(parsed.kind);
    const cfg = { endpoint: parsed.endpoint, token: parsed.token, config: parsed.config ?? {} };
    const result = await connector.validate(cfg);
    if (!result.ok) throw new BadRequestException(`could not connect: ${result.error ?? "validation failed"}`);

    const rec: ConnectionRecord = {
      id: randomUUID(),
      kind: parsed.kind,
      endpoint: parsed.endpoint,
      label: parsed.label ?? null,
      config: parsed.config ?? {},
      secretCipher: this.cipher.encrypt(parsed.token),
      cursor: {},
      status: "connected",
      lastSyncAt: null,
      lastError: null,
      createdAt: new Date(),
    };
    await this.store.create(rec);
    return this.toPublic(rec);
  }

  async list(): Promise<Connection[]> {
    return (await this.store.list()).map((r) => this.toPublic(r));
  }

  /** Disconnect = hard delete (FR-3): the encrypted secret is erased. */
  async disconnect(id: string): Promise<void> {
    if (!(await this.store.get(id))) throw new NotFoundException();
    await this.store.delete(id);
  }
}
