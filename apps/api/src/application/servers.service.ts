import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { NewServer, Server } from "@rcw/shared";
import { SERVER_STORE, type ServerStore } from "../domain/servers/server-store.port";

@Injectable()
export class ServersService {
  constructor(@Inject(SERVER_STORE) private readonly store: ServerStore) {}

  /** The cowork server's public key — agents install this on a self-added VPS so the
   *  platform can reach it. Surfaced by the API; provisioning stays the user's action. */
  coworkPublicKey(): string | null {
    return process.env.COWORK_SSH_PUBKEY?.trim() || null;
  }

  /** Admin registers a shared company server (no owner → assignable via ACL). */
  async createCompany(input: NewServer, createdBy: string): Promise<Server> {
    return this.store.create({ id: randomUUID(), ...this.norm(input), ownerAccountId: null, createdBy, createdAt: new Date() });
  }

  /** An agent self-adds their own VPS (owned → immediately accessible to them). */
  async createOwned(input: NewServer, accountId: string): Promise<Server> {
    return this.store.create({ id: randomUUID(), ...this.norm(input), ownerAccountId: accountId, createdBy: accountId, createdAt: new Date() });
  }

  private norm(input: NewServer) {
    return { name: input.name.trim(), host: input.host.trim(), sshUser: input.sshUser, sshPort: input.sshPort, description: input.description ?? "" };
  }

  async get(id: string): Promise<Server | null> {
    return this.store.get(id);
  }

  /** Admin view: every server with its ACL usernames attached. */
  async listAllWithAccess(): Promise<Server[]> {
    const all = await this.store.listAll();
    return Promise.all(all.map(async (s) => ({ ...s, access: s.ownerAccountId ? undefined : await this.store.accessUsernames(s.id) })));
  }

  async listForAccount(accountId: string): Promise<Server[]> {
    return this.store.listForAccount(accountId);
  }

  async update(id: string, patch: Partial<Server>): Promise<Server | null> {
    return this.store.update(id, patch);
  }
  async remove(id: string): Promise<boolean> {
    return this.store.remove(id);
  }
  async grant(serverId: string, accountId: string): Promise<void> {
    await this.store.grant(serverId, accountId);
  }
  async revoke(serverId: string, accountId: string): Promise<void> {
    await this.store.revoke(serverId, accountId);
  }
  async canAccess(serverId: string, accountId: string): Promise<boolean> {
    return this.store.canAccess(serverId, accountId);
  }
  /** True only if the account owns the server (self-added). */
  async isOwner(serverId: string, accountId: string): Promise<boolean> {
    const s = await this.store.get(serverId);
    return !!s && s.ownerAccountId === accountId;
  }
}
