/** One stored Claude config profile as persisted: the slug name + the env map
 * ciphertext (opaque to the store; the service owns the cipher). */
export type ClaudeConfigRecord = {
  name: string;
  envEncrypted: string;
};

/**
 * Persistence for named Claude config profiles. The store treats `envEncrypted`
 * as an opaque string — encryption/decryption lives in ClaudeConfigService so the
 * adapters never touch secrets in the clear.
 */
export interface ClaudeConfigStore {
  get(name: string): Promise<ClaudeConfigRecord | null>;
  /** Names only — never materializes any env values. */
  list(): Promise<{ name: string }[]>;
  upsert(name: string, envEncrypted: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export const CLAUDE_CONFIG_STORE = Symbol("ClaudeConfigStore");
