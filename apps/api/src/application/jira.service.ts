import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { JiraBinding, JiraIssue, JiraIssueDetail, JiraProfileSummary } from "@rcw/shared";
import { JIRA_PROFILE_STORE, type JiraProfileStore } from "../domain/jira/jira-profile.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";
import { CredentialCipher } from "../infrastructure/credential-cipher";
import { JiraClient } from "../adapters/jira/jira-client";

/** Marker for PATs stored in the clear when CRED_ENCRYPTION_KEY is unset (dev). */
const PLAINTEXT_PREFIX = "plain:";

/**
 * Per-session Jira integration. Owns named Jira profiles (base URL + PAT encrypted
 * at rest, mirroring ClaudeConfigService), and reads live sprint issues / issue
 * detail for a session via its binding. The PAT never leaves the server — list()
 * returns only the validated account displayName.
 */
@Injectable()
export class JiraService {
  /** Overridable in tests to stub Jira HTTP; defaults to global fetch. */
  fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(JIRA_PROFILE_STORE) private readonly store: JiraProfileStore,
    private readonly cipher: CredentialCipher,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  /** All profiles; best-effort account lookup (never throws, never leaks the PAT). */
  async list(): Promise<JiraProfileSummary[]> {
    const recs = await this.store.list();
    return Promise.all(
      recs.map(async (rec) => {
        let account: string | null = null;
        try {
          const me = await new JiraClient(rec.baseUrl, this.decryptPat(rec.patEncrypted), this.fetchImpl).myself();
          account = me.displayName || null;
        } catch {
          account = null;
        }
        return { name: rec.name, baseUrl: rec.baseUrl, account };
      }),
    );
  }

  /** Validate creds, then encrypt + store. Returns the summary (with account). */
  async upsert(name: string, input: { baseUrl: string; pat: string }): Promise<JiraProfileSummary> {
    let account: string | null = null;
    try {
      const me = await new JiraClient(input.baseUrl, input.pat, this.fetchImpl).myself();
      account = me.displayName || null;
    } catch (e) {
      throw new BadRequestException(`Jira auth failed: ${e instanceof Error ? e.message : "request failed"}`);
    }
    const patEncrypted = this.cipher.isConfigured() ? this.cipher.encrypt(input.pat) : PLAINTEXT_PREFIX + input.pat;
    await this.store.upsert({ name, baseUrl: input.baseUrl, patEncrypted, createdAt: new Date() });
    return { name, baseUrl: input.baseUrl, account };
  }

  async remove(name: string): Promise<void> {
    await this.store.remove(name);
  }

  /** Re-validate a stored profile's PAT. */
  async validate(name: string): Promise<{ ok: boolean; account?: string; error?: string }> {
    const rec = await this.store.get(name);
    if (!rec) throw new NotFoundException();
    try {
      const me = await new JiraClient(rec.baseUrl, this.decryptPat(rec.patEncrypted), this.fetchImpl).myself();
      return { ok: true, account: me.displayName || undefined };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "request failed" };
    }
  }

  /** A client for a stored profile, or null if the profile is unknown. */
  private async clientFor(name: string): Promise<JiraClient | null> {
    const rec = await this.store.get(name);
    if (!rec) return null;
    return new JiraClient(rec.baseUrl, this.decryptPat(rec.patEncrypted), this.fetchImpl);
  }

  async getBinding(sessionId: string): Promise<JiraBinding | null> {
    const s = await this.sessions.get(sessionId);
    if (!s) throw new NotFoundException();
    return s.jira ?? null;
  }

  async setBinding(sessionId: string, binding: JiraBinding): Promise<JiraBinding> {
    const updated = await this.sessions.patchState(sessionId, { jira: binding });
    if (!updated) throw new NotFoundException();
    return binding;
  }

  async clearBinding(sessionId: string): Promise<void> {
    const updated = await this.sessions.patchState(sessionId, { jira: null });
    if (!updated) throw new NotFoundException();
  }

  /** Live sprint issues for a session; [] when the session has no binding. */
  async sessionIssues(sessionId: string): Promise<JiraIssue[]> {
    const binding = await this.getBinding(sessionId);
    if (!binding) return [];
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    return client.sprintIssues(binding.projectKey);
  }

  /** Full detail for one issue under a session's binding. */
  async issueDetail(sessionId: string, key: string): Promise<JiraIssueDetail> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    return client.issueDetail(key);
  }

  private decryptPat(stored: string): string {
    return stored.startsWith(PLAINTEXT_PREFIX) ? stored.slice(PLAINTEXT_PREFIX.length) : this.cipher.decrypt(stored);
  }
}
