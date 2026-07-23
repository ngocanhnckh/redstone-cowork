import type { Account, AccountProfilePatch, AccountRole, JiraNotification, LoginAuditEntry } from "@rcw/shared";

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
};

export type AccountTokenRecord = {
  tokenHash: string;
  accountId: string;
  label: string;
  createdAt: Date;
  kind?: "session" | "host";
};

export interface AccountStore {
  create(rec: NewAccountRecord): Promise<Account>;
  findByUsername(username: string): Promise<(Account & { passwordHash: string }) | null>;
  findById(id: string): Promise<Account | null>;
  /** Find an account by its Jira DC username (case-insensitive). */
  findByJiraUsername(jira: string): Promise<Account | null>;
  /** Store the encrypted Jira PAT + base URL minted during Jira OAuth sign-in. */
  setJiraCredentials(id: string, baseUrl: string, patEncrypted: string): Promise<void>;
  /** The encrypted Jira PAT for this account (null = none linked). */
  getJiraPatEncrypted(id: string): Promise<{ baseUrl: string; patEncrypted: string } | null>;

  // ——— Face biometrics + device trust ———
  addFaceDescriptor(accountId: string, descriptor: number[]): Promise<void>;
  getFaceDescriptors(accountId: string): Promise<number[][]>;
  trustDevice(rec: { id: string; accountId: string; secretHash: string; label: string; createdAt: Date }): Promise<void>;
  /** Resolve a device secret hash → its account (enabled + not revoked); touches last_used. */
  findDeviceAccount(secretHash: string, now: Date): Promise<Account | null>;
  list(): Promise<Account[]>;
  count(): Promise<number>;
  setDisabled(id: string, at: Date | null): Promise<boolean>;
  setPassword(id: string, passwordHash: string): Promise<boolean>;
  /** Merge admin-editable profile fields; returns the updated account (null = unknown id). */
  updateProfile(id: string, patch: AccountProfilePatch): Promise<Account | null>;

  // Jira in-app notifications (issue assigned to the agent was updated).
  addJiraNotification(n: JiraNotification): Promise<void>;
  listJiraNotifications(accountId: string, opts?: { unseenOnly?: boolean; limit?: number }): Promise<JiraNotification[]>;
  markJiraNotificationsSeen(accountId: string, at: Date): Promise<void>;

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
