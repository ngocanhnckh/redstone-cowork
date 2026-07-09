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

  /** Create an issue and return its key + browse URL. Throws with Jira's error body on failure. */
  async createIssue(
    projectKey: string,
    summary: string,
    opts?: { description?: string; assignee?: { name?: string; accountId?: string }; issueType?: string },
  ): Promise<{ key: string; url: string }> {
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary,
      issuetype: { name: opts?.issueType ?? "Task" },
      ...(opts?.description ? { description: opts.description } : {}),
      ...(opts?.assignee ? { assignee: opts.assignee } : {}),
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
      const res = await this.fetchImpl(`${this.base}/rest/agile/1.0/board/${boardId}/sprint?state=active`, {
        headers: this.headers(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { values?: Array<{ id?: number }> };
      const sprintId = data.values?.[0]?.id;
      if (sprintId == null) return;
      await this.fetchImpl(`${this.base}/rest/agile/1.0/sprint/${sprintId}/issue`, {
        method: "POST",
        headers: this.jsonHeaders(),
        body: JSON.stringify({ issues: [issueKey] }),
      });
    } catch {
      // best-effort — a failure here must not fail issue creation
    }
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

  /** Full detail for one issue: rendered description + rendered comments. */
  async issueDetail(key: string): Promise<JiraIssueDetail> {
    const url = `${this.base}/rest/api/2/issue/${encodeURIComponent(key)}?expand=renderedFields&fields=${encodeURIComponent(
      "summary,status,assignee,comment",
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
    return { ...base, descriptionHtml: raw.renderedFields?.description ?? "", comments };
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
