import type { Server } from "@rcw/shared";

export type NewServerRecord = {
  id: string;
  name: string;
  host: string;
  sshUser: string;
  sshPort: number;
  description: string;
  ownerAccountId: string | null;
  createdBy: string | null;
  createdAt: Date;
};

export interface ServerStore {
  create(rec: NewServerRecord): Promise<Server>;
  get(id: string): Promise<Server | null>;
  listAll(): Promise<Server[]>;
  /** Company servers this account may use (via ACL) plus servers it owns. */
  listForAccount(accountId: string): Promise<Server[]>;
  update(id: string, patch: Partial<Pick<Server, "name" | "host" | "sshUser" | "sshPort" | "description" | "keyInstalled">>): Promise<Server | null>;
  remove(id: string): Promise<boolean>;

  grant(serverId: string, accountId: string): Promise<void>;
  revoke(serverId: string, accountId: string): Promise<void>;
  accessUsernames(serverId: string): Promise<string[]>;
  /** True if the account owns the server or has an ACL grant. */
  canAccess(serverId: string, accountId: string): Promise<boolean>;
}

export const SERVER_STORE = Symbol("ServerStore");
