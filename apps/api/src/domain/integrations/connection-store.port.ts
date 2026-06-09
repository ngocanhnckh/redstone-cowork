import type { ConnectorKind, ConnectionStatus } from "@rcw/shared";

/** Internal record — includes the encrypted secret and sync cursor. */
export type ConnectionRecord = {
  id: string;
  kind: ConnectorKind;
  endpoint: string;
  label: string | null;
  config: Record<string, unknown>;
  secretCipher: string;
  cursor: Record<string, unknown>;
  status: ConnectionStatus;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
};

export interface ConnectionStore {
  create(rec: ConnectionRecord): Promise<ConnectionRecord>;
  list(): Promise<ConnectionRecord[]>;
  get(id: string): Promise<ConnectionRecord | null>;
  /** Persist sync outcome: new cursor, status, lastError, lastSyncAt. */
  updateSync(id: string, patch: Pick<ConnectionRecord, "cursor" | "status" | "lastError" | "lastSyncAt">): Promise<void>;
  delete(id: string): Promise<void>;
}
export const CONNECTION_STORE = Symbol("ConnectionStore");
