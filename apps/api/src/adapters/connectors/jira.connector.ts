import type { IngestedEvent } from "@rcw/shared";
import type { Connector, ConnectorConfig, PullResult } from "../../domain/integrations/connector.port";

/**
 * Jira connector — PAT auth, works against self-hosted Data Center (API v2) and
 * Cloud (`Authorization: Bearer <pat>`). Pulls issues touching the user (assignee,
 * reporter, watcher) updated since the cursor, plus their latest comments.
 */
export class JiraConnector implements Connector {
  readonly kind = "jira" as const;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private headers(token: string) {
    return { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
  }

  async validate(cfg: ConnectorConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.fetchImpl(`${cfg.endpoint.replace(/\/$/, "")}/rest/api/2/myself`, {
        headers: this.headers(cfg.token),
      });
      if (!res.ok) return { ok: false, error: `Jira responded ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "request failed" };
    }
  }

  async pull(cfg: ConnectorConfig, cursor: Record<string, unknown>): Promise<PullResult> {
    const base = cfg.endpoint.replace(/\/$/, "");
    const since = typeof cursor.updatedSince === "string" ? cursor.updatedSince : null;
    // JQL: issues touching me, updated since last cursor. Jira wants 'YYYY-MM-DD HH:mm'.
    const clauses = ["(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser())"];
    if (since) clauses.push(`updated > "${since}"`);
    const jql = encodeURIComponent(clauses.join(" AND ") + " ORDER BY updated ASC");
    const res = await this.fetchImpl(
      `${base}/rest/api/2/search?jql=${jql}&maxResults=50&fields=summary,status,updated,assignee,reporter,comment`,
      { headers: this.headers(cfg.token) },
    );
    if (!res.ok) throw new Error(`Jira search ${res.status}`);
    const data = (await res.json()) as { issues?: JiraIssue[] };
    const issues = data.issues ?? [];

    const events: IngestedEvent[] = [];
    let maxUpdated = since;
    for (const issue of issues) {
      const f = issue.fields ?? {};
      const updated = f.updated ?? new Date().toISOString();
      events.push({
        source: "jira",
        sourceId: issue.key,
        type: "jira.issue.updated",
        occurredAt: new Date(updated),
        actor: f.assignee?.displayName ?? f.reporter?.displayName ?? null,
        payload: { key: issue.key, summary: f.summary, status: f.status?.name },
        links: [{ rel: "self", href: `${base}/browse/${issue.key}` }],
      });
      for (const c of f.comment?.comments ?? []) {
        events.push({
          source: "jira",
          sourceId: `${issue.key}#${c.id}`,
          type: "jira.comment",
          occurredAt: new Date(c.created ?? updated),
          actor: c.author?.displayName ?? null,
          payload: { key: issue.key, body: c.body },
          links: [{ rel: "self", href: `${base}/browse/${issue.key}` }],
        });
      }
      if (!maxUpdated || updated > maxUpdated) maxUpdated = updated;
    }
    // store cursor in Jira's expected format for the next 'updated >' filter
    const nextCursor = maxUpdated ? { updatedSince: toJiraTime(maxUpdated) } : cursor;
    return { events, cursor: nextCursor };
  }
}

function toJiraTime(iso: string): string {
  // "2026-06-09T11:22:33.000+0000" or ISO → "YYYY-MM-DD HH:mm"
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

type JiraIssue = {
  key: string;
  fields?: {
    summary?: string;
    updated?: string;
    status?: { name?: string };
    assignee?: { displayName?: string };
    reporter?: { displayName?: string };
    comment?: { comments?: Array<{ id: string; created?: string; body?: string; author?: { displayName?: string } }> };
  };
};
