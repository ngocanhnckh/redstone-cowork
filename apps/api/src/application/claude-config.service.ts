import { Inject, Injectable } from "@nestjs/common";
import {
  ClaudeConfigEnvSchema,
  type ClaudeConfigEnv,
  type ClaudeConfigProfile,
} from "@rcw/shared";
import { CLAUDE_CONFIG_STORE, type ClaudeConfigStore } from "../domain/claude-configs/claude-config.port";
import { CredentialCipher } from "../infrastructure/credential-cipher";

/** Marker for env maps stored in the clear when CRED_ENCRYPTION_KEY is unset (dev). */
const PLAINTEXT_PREFIX = "plain:";

/**
 * Named Claude config profiles: the env map is encrypted at rest with the shared
 * CredentialCipher (AES-256-GCM). When CRED_ENCRYPTION_KEY is unset it degrades to
 * a "plain:"-tagged JSON blob so the feature still works in dev — the same env map
 * a stored row would hold, just not encrypted.
 */
@Injectable()
export class ClaudeConfigService {
  constructor(
    @Inject(CLAUDE_CONFIG_STORE) private readonly store: ClaudeConfigStore,
    private readonly cipher: CredentialCipher,
  ) {}

  /** Profile names only — never decrypts or exposes values. */
  async list(): Promise<{ name: string }[]> {
    return this.store.list();
  }

  /** Fetch a profile with its decrypted env map, or null if absent. */
  async get(name: string): Promise<ClaudeConfigProfile | null> {
    const rec = await this.store.get(name);
    if (!rec) return null;
    return { name: rec.name, env: this.decryptEnv(rec.envEncrypted) };
  }

  /** Encrypt and persist a profile's env map (insert or replace). */
  async upsert(name: string, env: ClaudeConfigEnv): Promise<void> {
    const json = JSON.stringify(ClaudeConfigEnvSchema.parse(env));
    const stored = this.cipher.isConfigured() ? this.cipher.encrypt(json) : PLAINTEXT_PREFIX + json;
    await this.store.upsert(name, stored);
  }

  async remove(name: string): Promise<void> {
    await this.store.remove(name);
  }

  private decryptEnv(stored: string): ClaudeConfigEnv {
    const json = stored.startsWith(PLAINTEXT_PREFIX)
      ? stored.slice(PLAINTEXT_PREFIX.length)
      : this.cipher.decrypt(stored);
    return ClaudeConfigEnvSchema.parse(JSON.parse(json));
  }
}
