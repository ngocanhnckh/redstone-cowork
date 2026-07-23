import type { Account, AccountProfilePatch, AccountRole, LoginAuditEntry } from "@rcw/shared";

export type NewAccountRecord = {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  passwordHash: string;
  createdAt: Date;
  photo?: string | null;
  level?: string;
  division?: string;
  email?: string;
  jira?: string;
  mattermost?: string;
  phone?: string;
  webhook?: string;
};

export type AccountTokenRecord = {
  tokenHash: string;
  accountId: string;
  label: string;
  createdAt: Date;
};

export interface AccountStore {
  create(rec: NewAccountRecord): Promise<Account>;
  findByUsername(username: string): Promise<(Account & { passwordHash: string }) | null>;
  findById(id: string): Promise<Account | null>;
  list(): Promise<Account[]>;
  count(): Promise<number>;
  setDisabled(id: string, at: Date | null): Promise<boolean>;
  setPassword(id: string, passwordHash: string): Promise<boolean>;
  /** Merge admin-editable profile fields; returns the updated account (null = unknown id). */
  updateProfile(id: string, patch: AccountProfilePatch): Promise<Account | null>;

  recordLogin(entry: LoginAuditEntry): Promise<void>;
  /** Newest-first audit entries; accountId narrows to one account. */
  listLoginAudit(opts?: { accountId?: string; limit?: number }): Promise<LoginAuditEntry[]>;

  addToken(rec: AccountTokenRecord): Promise<void>;
  /** Resolve a token hash to its (enabled) account; touches last_used_at. A token
   *  idle longer than maxIdleMs (no request since) is expired and resolves null. */
  findByTokenHash(tokenHash: string, now: Date, maxIdleMs: number): Promise<Account | null>;
  revokeToken(tokenHash: string, at: Date): Promise<boolean>;
  revokeAllTokens(accountId: string, at: Date): Promise<number>;
}

export const ACCOUNT_STORE = Symbol("AccountStore");
