import type { JiraComment, JiraIssue, JiraIssueDetail, JiraStatusCategory } from "@rcw/shared";

/** Jira's statusCategory.key → coarse UI bucket. */
export function mapCat(key: string | undefined): JiraStatusCategory {
  switch (key) {
    case "done":
      return "done";
    case "indeterminate":
      return "inprogress";
    case "new":
      return "todo";
    default:
      return "todo";
  }
}

type RawIssue = {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
    description?: string | null;
    issuetype?: { name?: string; subtask?: boolean };
    subtasks?: RawIssue[];
  };
  renderedFields?: {
    description?: string | null;
    comment?: { comments?: RawComment[] };
  };
};

type RawComment = {
  author?: { displayName?: string } | null;
  created?: string;
  body?: string;
};

/**
 * Thin Jira REST v2 client for the per-session integration. Bearer PAT auth
 * against self-hosted Data Center (also works on Cloud). Every method throws with
 * a helpful message on a non-ok response so the service/controller can surface it.
 */
export class JiraClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly pat: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  private headers() {
    return { Authorization: `Bearer ${this.pat}`, Accept: "application/json" };
  }

  private jsonHeaders() {
    return { ...this.headers(), "Content-Type": "application/json" };
  }

  /**
   * Validate the PAT and return the authenticated user. Jira Data Center returns
   * `name` (the username, used for the `assignee.name` write field) and `key`;
   * Cloud returns `accountId`. We surface whatever is present.
   */
  async myself(): Promise<{ accountId?: string; name?: string; displayName: string }> {
    const res = await this.fetchImpl(`${this.base}/rest/api/2/myself`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jira /myself responded ${res.status}`);
    const data = (await res.json()) as { accountId?: string; displayName?: string; name?: string };
    return { accountId: data.accountId, name: data.name, displayName: data.displayName ?? data.name ?? "" };
  }

  /** All projects visible to the PAT (key + name) — for binding dropdowns. */
  async listProjects(): Promise<Array<{ key: string; name: string }>> {
    const res = await this.fetchImpl(`${this.base}/rest/api/2/project`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jira /project responded ${res.status}`);
    const arr = (await res.json()) as Array<{ key?: string; name?: string }>;
    return arr
      .filter((p) => p.key)
      .map((p) => ({ key: p.key as string, name: p.name ?? (p.key as string) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Search users (Jira DC: /user/search?username=). Returns the writable `name`
   *  (used for assignee), plus display name / email / avatar for the picker. */
  async searchUsers(query: string): Promise<Array<{ name: string; key?: string; displayName: string; email?: string; avatarUrl?: string }>> {
    const q = query.trim() || ".";
    const res = await this.fetchImpl(
      `${this.base}/rest/api/2/user/search?username=${encodeURIComponent(q)}&maxResults=20`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Jira /user/search responded ${res.status}`);
    const arr = (await res.json()) as Array<{ name?: string; key?: string; accountId?: string; displayName?: string; emailAddress?: string; avatarUrls?: Record<string, string> }>;
    return arr.map((u) => ({
      name: u.name ?? u.accountId ?? "",
      key: u.key,
      displayName: u.displayName ?? u.name ?? "",
      email: u.emailAddress,
      avatarUrl: u.avatarUrls?.["48x48"] ?? u.avatarUrls?.["32x32"],
    }));
  }

  /** Create an issue and return its key + browse URL. Throws with Jira's error body on failure. */
  async createIssue(
    projectKey: string,
    summary: string,
    opts?: { description?: string; assignee?: { name?: string; accountId?: string }; issueType?: string; parentKey?: string },
  ): Promise<{ key: string; url: string }> {
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary,
      issuetype: { name: opts?.issueType ?? "Task" },
      ...(opts?.description ? { description: opts.description } : {}),
      ...(opts?.assignee ? { assignee: opts.assignee } : {}),
      // A subtask must reference its parent issue at create time.
      ...(opts?.parentKey ? { parent: { key: opts.parentKey } } : {}),
    };
    const res = await this.fetchImpl(`${this.base}/rest/api/2/issue`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Jira create issue responded ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as { key: string };
    return { key: data.key, url: `${this.base}/browse/${data.key}` };
  }

  /** Patch an issue's editable fields (summary / description). No-op if given neither. */
  async updateIssue(key: string, fields: { summary?: string; description?: string }): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (fields.summary != null) patch.summary = fields.summary;
    if (fields.description != null) patch.description = fields.description;
    if (Object.keys(patch).length === 0) return;
    const res = await this.fetchImpl(`${this.base}/rest/api/2/issue/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ fields: patch }),
    });
    if (!res.ok) throw new Error(`Jira update issue ${key} responded ${res.status}: ${await res.text().catch(() => "")}`);
  }

  /**
   * The project's subtask issue-type name (e.g. "Sub-task", "Subtask"). Jira lets
   * projects rename it, so discover it from the project's issue types rather than
   * hardcoding. Falls back to "Sub-task" (the Jira default) if none is found.
   */
  async subtaskTypeName(projectKey: string): Promise<string> {
    try {
      const res = await this.fetchImpl(`${this.base}/rest/api/2/project/${encodeURIComponent(projectKey)}`, {
        headers: this.headers(),
      });
      if (res.ok) {
        const data = (await res.json()) as { issueTypes?: Array<{ name?: string; subtask?: boolean }> };
        const sub = (data.issueTypes ?? []).find((t) => t.subtask && t.name);
        if (sub?.name) return sub.name;
      }
    } catch {
      /* fall through to the default */
    }
    return "Sub-task";
  }

  /** Add a plain-text comment to an issue. */
  async addComment(key: string, body: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`Jira add comment responded ${res.status}: ${await res.text().catch(() => "")}`);
  }

  /** Best-effort: move a freshly-created issue into the board's active sprint. Swallows errors. */
  async addToActiveSprint(boardId: number, issueKey: string): Promise<void> {
    try {
      const sprintId = await this.activeSprintOfBoard(boardId);
      if (sprintId != null) await this.moveIssueToSprint(sprintId, issueKey);
    } catch {
      // best-effort — a failure here must not fail issue creation
    }
  }

  /**
   * Best-effort: put a freshly-created issue into the project's CURRENT sprint,
   * auto-discovering the board (so no boardId needs to be configured). Finds the
   * project's boards, prefers scrum boards (they own sprints), and adds the issue to
   * the first board that has an active sprint. No-op if the project has no active
   * sprint (kanban / sprint not started) — the issue simply stays in the backlog.
   */
  async addToProjectActiveSprint(projectKey: string, issueKey: string): Promise<void> {
    try {
      const res = await this.fetchImpl(
        `${this.base}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}`,
        { headers: this.headers() },
      );
      if (!res.ok) return;
      const boards = ((await res.json()) as { values?: Array<{ id: number; type?: string }> }).values ?? [];
      // Scrum boards first — they're the ones with sprints.
      boards.sort((a, b) => (b.type === "scrum" ? 1 : 0) - (a.type === "scrum" ? 1 : 0));
      for (const b of boards) {
        const sprintId = await this.activeSprintOfBoard(b.id);
        if (sprintId != null) { await this.moveIssueToSprint(sprintId, issueKey); return; }
      }
    } catch {
      // best-effort
    }
  }

  /** The active sprint id for a board, or null (no active sprint / not a scrum board). */
  private async activeSprintOfBoard(boardId: number): Promise<number | null> {
    const res = await this.fetchImpl(`${this.base}/rest/agile/1.0/board/${boardId}/sprint?state=active`, {
      headers: this.headers(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { values?: Array<{ id?: number }> };
    return data.values?.[0]?.id ?? null;
  }

  private async moveIssueToSprint(sprintId: number, issueKey: string): Promise<void> {
    await this.fetchImpl(`${this.base}/rest/agile/1.0/sprint/${sprintId}/issue`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ issues: [issueKey] }),
    });
  }

  /**
   * Issues assigned to the current user in the project's open sprint. If the
   * project has no sprint field (Jira Core / Software with no board), the sprint
   * JQL 400s, so we retry once with a plain "not done" JQL.
   */
  async sprintIssues(projectKey: string): Promise<JiraIssue[]> {
    const project = escapeJqlValue(projectKey);
    const fields = "summary,status,assignee";
    const sprintJql = `project = "${project}" AND assignee = currentUser() AND sprint in openSprints() ORDER BY status`;
    const fallbackJql = `project = "${project}" AND assignee = currentUser() AND statusCategory != Done ORDER BY status`;

    const run = async (jql: string) => {
      const url = `${this.base}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(
        fields,
      )}&maxResults=100`;
      return this.fetchImpl(url, { headers: this.headers() });
    };

    let res = await run(sprintJql);
    if (res.status === 400) res = await run(fallbackJql);
    if (!res.ok) throw new Error(`Jira search responded ${res.status}`);
    const data = (await res.json()) as { issues?: RawIssue[] };
    return (data.issues ?? []).map((i) => this.toIssue(i));
  }

  /** Full detail for one issue: rendered description + rendered comments, plus the
   * raw description (editable), issue type, subtask-ability, and existing subtasks. */
  async issueDetail(key: string): Promise<JiraIssueDetail> {
    const url = `${this.base}/rest/api/2/issue/${encodeURIComponent(key)}?expand=renderedFields&fields=${encodeURIComponent(
      "summary,status,assignee,comment,description,issuetype,subtasks",
    )}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jira issue ${key} responded ${res.status}`);
    const raw = (await res.json()) as RawIssue;
    const base = this.toIssue(raw);
    const comments: JiraComment[] = (raw.renderedFields?.comment?.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? null,
      created: c.created ?? "",
      bodyHtml: c.body ?? "",
    }));
    const itype = raw.fields?.issuetype;
    // A standard issue (not itself a subtask, and not an Epic) can own subtasks.
    const subtaskAllowed = !!itype && itype.subtask !== true && itype.name !== "Epic";
    const subtasks = (raw.fields?.subtasks ?? []).map((s) => this.toIssue(s));
    return {
      ...base,
      descriptionHtml: raw.renderedFields?.description ?? "",
      description: raw.fields?.description ?? "",
      issueType: itype?.name ?? "",
      subtaskAllowed,
      subtasks,
      comments,
    };
  }

  /**
   * Available workflow transitions for an issue, as `{id, name, to}` where `to` is
   * the destination status name. Jira computes these per-issue from the project's
   * workflow — so custom statuses come through automatically (no hardcoding).
   */
  async transitions(key: string): Promise<Array<{ id: string; name: string; to: string }>> {
    const url = `${this.base}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jira transitions ${key} responded ${res.status}`);
    const data = (await res.json()) as { transitions?: Array<{ id: string; name?: string; to?: { name?: string } }> };
    return (data.transitions ?? []).map((t) => ({ id: t.id, name: t.name ?? "", to: t.to?.name ?? t.name ?? "" }));
  }

  /** Apply a workflow transition (change the issue's status). */
  async transition(key: string, transitionId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
    if (!res.ok) throw new Error(`Jira transition ${key} responded ${res.status}: ${await res.text().catch(() => "")}`);
  }

  private toIssue(i: RawIssue): JiraIssue {
    const f = i.fields ?? {};
    return {
      key: i.key,
      summary: f.summary ?? "",
      status: f.status?.name ?? "",
      statusCategory: mapCat(f.status?.statusCategory?.key),
      assignee: f.assignee?.displayName ?? null,
      url: `${this.base}/browse/${i.key}`,
    };
  }
}

/** Escape a value going into a double-quoted JQL string literal. */
function escapeJqlValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
