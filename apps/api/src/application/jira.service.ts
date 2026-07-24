import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { JiraBinding, JiraIssue, JiraIssueDetail, JiraProfileSummary } from "@rcw/shared";
import { JIRA_PROFILE_STORE, type JiraProfileStore } from "../domain/jira/jira-profile.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";
import { CredentialCipher } from "../infrastructure/credential-cipher";
import { JiraClient } from "../adapters/jira/jira-client";

/** Marker for PATs stored in the clear when CRED_ENCRYPTION_KEY is unset (dev). */
const PLAINTEXT_PREFIX = "plain:";

/** Per-agent Jira workload counts, for the Agency leaderboard. */
export type AgencyJiraStat = { accountId: string; completed: number; inProgress: number; todo: number; total: number };

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

  /** Projects visible under a stored profile — powers the session's project dropdown. */
  async listProjects(profileName: string): Promise<Array<{ key: string; name: string }>> {
    const client = await this.clientFor(profileName);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${profileName}`);
    return client.listProjects();
  }

  /** Search Jira users under a stored profile — powers the admin agent→Jira picker. */
  async searchUsers(profileName: string, query: string): Promise<Array<{ name: string; key?: string; displayName: string; email?: string; avatarUrl?: string }>> {
    const client = await this.clientFor(profileName);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${profileName}`);
    return client.searchUsers(query);
  }

  /** The org-wide default Jira profile (first configured), or null. */
  async defaultProfile(): Promise<string | null> {
    return (await this.store.list())[0]?.name ?? null;
  }

  // Roster Jira stats are refreshed at most every few minutes (counts are cheap but we
  // still don't want to hammer Jira on every 15s leaderboard poll).
  private rosterStatsCache: { key: string; at: number; data: AgencyJiraStat[] } | null = null;

  /** Completed / in-progress / to-do counts per agent (by their Jira username). */
  async rosterStats(users: Array<{ accountId: string; jiraUser: string }>): Promise<AgencyJiraStat[]> {
    const profile = await this.defaultProfile();
    if (!profile || users.length === 0) return [];
    const key = profile + "|" + users.map((u) => `${u.accountId}:${u.jiraUser}`).join(",");
    const now = Date.now();
    if (this.rosterStatsCache && this.rosterStatsCache.key === key && now - this.rosterStatsCache.at < 180_000) {
      return this.rosterStatsCache.data;
    }
    const client = await this.clientFor(profile);
    if (!client) return [];
    const data = await Promise.all(users.map(async (u) => {
      try { return { accountId: u.accountId, ...(await client.assigneeStats(u.jiraUser)) }; }
      catch { return { accountId: u.accountId, completed: 0, inProgress: 0, todo: 0, total: 0 }; }
    }));
    this.rosterStatsCache = { key, at: now, data };
    return data;
  }

  /** An agent's assigned Jira issues (newest first) under the default profile. */
  async assignedIssues(jiraUser: string): Promise<JiraIssue[]> {
    const profile = await this.defaultProfile();
    if (!profile || !jiraUser) return [];
    const client = await this.clientFor(profile);
    if (!client) return [];
    return client.assignedIssues(jiraUser);
  }

  /** A client on the org-wide default profile (for account-scoped mission actions). */
  private async defaultClient(): Promise<JiraClient> {
    const profile = await this.defaultProfile();
    const client = profile ? await this.clientFor(profile) : null;
    if (!client) throw new BadRequestException("No Jira profile configured");
    return client;
  }

  /** Mission (assigned issue) detail under the default profile. */
  async missionDetail(key: string): Promise<JiraIssueDetail> {
    return (await this.defaultClient()).issueDetail(key);
  }
  async missionTransitions(key: string): Promise<Array<{ id: string; name: string; to: string }>> {
    return (await this.defaultClient()).transitions(key);
  }
  async missionTransition(key: string, transitionId: string): Promise<void> {
    await (await this.defaultClient()).transition(key, transitionId);
  }
  async missionComment(key: string, body: string): Promise<void> {
    await (await this.defaultClient()).addComment(key, body);
  }

  /** A client for a stored profile, or null if the profile is unknown. */
  private async clientFor(name: string): Promise<JiraClient | null> {
    const rec = await this.store.get(name);
    if (!rec) return null;
    return new JiraClient(rec.baseUrl, this.decryptPat(rec.patEncrypted), this.fetchImpl);
  }

  /** A client for a session's bound profile; throws BadRequest if unbound/unknown. */
  private async clientForSession(sessionId: string): Promise<JiraClient> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    return client;
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

  /**
   * Create an issue in the session's bound project, assigned to the profile's own
   * user (DC `name`, else Cloud `accountId`), and best-effort add it to the board's
   * active sprint. Returns a JiraIssue for the new issue (status "To Do" / todo).
   */
  async createSessionIssue(sessionId: string, summary: string, description?: string): Promise<JiraIssue> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    const me = await client.myself();
    const assignee = me.name ? { name: me.name } : me.accountId ? { accountId: me.accountId } : undefined;
    const { key, url } = await client.createIssue(binding.projectKey, summary, { description, assignee });
    // Put it in the current sprint. Use the configured board if set, otherwise
    // auto-discover the project's board — so a new task always lands in the active
    // sprint when the project has one (no boardId configuration required).
    if (binding.boardId != null) await client.addToActiveSprint(binding.boardId, key);
    else await client.addToProjectActiveSprint(binding.projectKey, key);
    return {
      key,
      summary,
      status: "To Do",
      statusCategory: "todo",
      assignee: me.displayName || null,
      url,
    };
  }

  /** Edit an issue's summary / description under a session's binding. */
  async updateIssue(sessionId: string, key: string, fields: { summary?: string; description?: string }): Promise<void> {
    const client = await this.clientForSession(sessionId);
    await client.updateIssue(key, fields);
  }

  /**
   * Create a subtask under a parent issue in the session's bound project, assigned
   * to the profile's own user, using the project's subtask issue type. Returns a
   * JiraIssue for the new subtask (status "To Do" / todo). Subtasks inherit their
   * parent's sprint, so there's no sprint step here.
   */
  async createSubtask(sessionId: string, parentKey: string, summary: string, description?: string): Promise<JiraIssue> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    const me = await client.myself();
    const assignee = me.name ? { name: me.name } : me.accountId ? { accountId: me.accountId } : undefined;
    const issueType = await client.subtaskTypeName(binding.projectKey);
    const { key, url } = await client.createIssue(binding.projectKey, summary, { description, assignee, issueType, parentKey });
    return {
      key,
      summary,
      status: "To Do",
      statusCategory: "todo",
      assignee: me.displayName || null,
      url,
    };
  }

  /** Add a comment to an issue under a session's binding. */
  async commentIssue(sessionId: string, key: string, body: string): Promise<void> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    await client.addComment(key, body);
  }

  /** Full detail for one issue under a session's binding. */
  async issueDetail(sessionId: string, key: string): Promise<JiraIssueDetail> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    return client.issueDetail(key);
  }

  /** Available status transitions for an issue (workflow-specific, incl. custom statuses). */
  async issueTransitions(sessionId: string, key: string): Promise<Array<{ id: string; name: string; to: string }>> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    return client.transitions(key);
  }

  /** Apply a status transition to an issue. */
  async transitionIssue(sessionId: string, key: string, transitionId: string): Promise<void> {
    const binding = await this.getBinding(sessionId);
    if (!binding) throw new BadRequestException("Session has no Jira binding");
    const client = await this.clientFor(binding.profile);
    if (!client) throw new BadRequestException(`Unknown Jira profile: ${binding.profile}`);
    await client.transition(key, transitionId);
  }

  private decryptPat(stored: string): string {
    return stored.startsWith(PLAINTEXT_PREFIX) ? stored.slice(PLAINTEXT_PREFIX.length) : this.cipher.decrypt(stored);
  }
}
