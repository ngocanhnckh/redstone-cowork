/** One stored Jira profile as persisted: the slug name, the base URL, and the PAT
 * ciphertext (opaque to the store; the service owns the cipher). */
export type JiraProfileRecord = {
  name: string;
  baseUrl: string;
  patEncrypted: string;
  createdAt: Date;
};

/**
 * Persistence for named Jira profiles. The store treats `patEncrypted` as an
 * opaque string — encryption/decryption lives in JiraService so the adapters
 * never touch the PAT in the clear.
 */
export interface JiraProfileStore {
  list(): Promise<JiraProfileRecord[]>;
  get(name: string): Promise<JiraProfileRecord | null>;
  upsert(rec: JiraProfileRecord): Promise<JiraProfileRecord>;
  remove(name: string): Promise<void>;
}

export const JIRA_PROFILE_STORE = Symbol("JIRA_PROFILE_STORE");
