import type { AccessKey, AccessKeyScope } from "@rcw/shared";

export type NewAccessKeyRecord = {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  scope: AccessKeyScope;
  createdAt: Date;
};

export interface AccessKeyStore {
  create(rec: NewAccessKeyRecord): Promise<AccessKey>;
  findByHash(keyHash: string): Promise<AccessKey | null>;
  list(): Promise<AccessKey[]>;
  revoke(id: string, at: Date): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
}

export const ACCESS_KEY_STORE = Symbol("AccessKeyStore");
