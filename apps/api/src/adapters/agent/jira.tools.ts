import type { AgentTool } from "../../domain/agent/agent.port";
import type { JiraService } from "../../application/jira.service";

/**
 * Agent tools that act on the CURRENT session's connected Jira project. Every tool
 * is bound to one session id; if the session has no Jira binding (or any call
 * fails) the tool returns a helpful string rather than throwing, so a failure here
 * never aborts the agent loop.
 */

/** "Session has no Jira binding" surfaced from the service → a friendly agent string. */
const NOT_CONNECTED = "This session isn't connected to a Jira project. Connect one from the session's Jira panel first.";

/** Strip HTML tags to plain text and collapse whitespace (for feeding to the LLM). */
function htmlToText(html: string | undefined | null): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turn any thrown error into a compact string; map the no-binding case to NOT_CONNECTED. */
function errString(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/no Jira binding/i.test(msg)) return NOT_CONNECTED;
  return `error: ${msg}`;
}

/** List the current session's open sprint issues. */
class JiraListSprintIssuesTool implements AgentTool {
  name = "jira_list_sprint_issues";
  description =
    "List the open sprint issues assigned to you in the CURRENT session's connected Jira project. Use to see what you're working on. No parameters.";
  parameters = { type: "object", properties: {}, required: [] as string[] };

  constructor(
    private readonly jira: JiraService,
    private readonly sessionId: string,
  ) {}

  async run(): Promise<string> {
    try {
      const issues = await this.jira.sessionIssues(this.sessionId);
      return JSON.stringify(issues.map((i) => ({ key: i.key, summary: i.summary, status: i.status, assignee: i.assignee })));
    } catch (e) {
      return errString(e);
    }
  }
}

/** Read full detail (description + comments as plain text) for one issue. */
class JiraGetIssueTool implements AgentTool {
  name = "jira_get_issue";
  description =
    "Get full detail for one issue in the CURRENT session's connected Jira project: summary, status, assignee, description text and comments.";
  parameters = {
    type: "object",
    properties: {
      key: { type: "string", description: "The issue key, e.g. 'RCW-12'." },
    },
    required: ["key"],
  };

  constructor(
    private readonly jira: JiraService,
    private readonly sessionId: string,
  ) {}

  async run(argsJson: string): Promise<string> {
    let key = "";
    try {
      key = String(JSON.parse(argsJson || "{}").key ?? "").trim();
    } catch {
      return "error: invalid tool arguments";
    }
    if (!key) return "error: missing 'key'";
    try {
      const d = await this.jira.issueDetail(this.sessionId, key);
      return JSON.stringify({
        key: d.key,
        summary: d.summary,
        status: d.status,
        assignee: d.assignee,
        description: htmlToText(d.descriptionHtml),
        comments: d.comments.map((c) => ({ author: c.author, body: htmlToText(c.bodyHtml) })),
      });
    } catch (e) {
      return errString(e);
    }
  }
}

/** Create a new issue in the current session's project, assigned to you. */
class JiraCreateIssueTool implements AgentTool {
  name = "jira_create_issue";
  description =
    "Create a new issue in the CURRENT session's connected Jira project, assigned to you and added to the active sprint. Returns the new issue's key and URL.";
  parameters = {
    type: "object",
    properties: {
      summary: { type: "string", description: "The issue title / summary." },
      description: { type: "string", description: "Optional issue description." },
    },
    required: ["summary"],
  };

  constructor(
    private readonly jira: JiraService,
    private readonly sessionId: string,
  ) {}

  async run(argsJson: string): Promise<string> {
    let summary = "";
    let description: string | undefined;
    try {
      const args = JSON.parse(argsJson || "{}");
      summary = String(args.summary ?? "").trim();
      description = args.description != null ? String(args.description) : undefined;
    } catch {
      return "error: invalid tool arguments";
    }
    if (!summary) return "error: missing 'summary'";
    try {
      const issue = await this.jira.createSessionIssue(this.sessionId, summary, description);
      return JSON.stringify({ key: issue.key, url: issue.url });
    } catch (e) {
      return errString(e);
    }
  }
}

/** Add a comment to an issue in the current session's project. */
class JiraCommentTool implements AgentTool {
  name = "jira_comment";
  description = "Add a comment to an issue in the CURRENT session's connected Jira project.";
  parameters = {
    type: "object",
    properties: {
      key: { type: "string", description: "The issue key, e.g. 'RCW-12'." },
      body: { type: "string", description: "The comment text." },
    },
    required: ["key", "body"],
  };

  constructor(
    private readonly jira: JiraService,
    private readonly sessionId: string,
  ) {}

  async run(argsJson: string): Promise<string> {
    let key = "";
    let body = "";
    try {
      const args = JSON.parse(argsJson || "{}");
      key = String(args.key ?? "").trim();
      body = String(args.body ?? "").trim();
    } catch {
      return "error: invalid tool arguments";
    }
    if (!key) return "error: missing 'key'";
    if (!body) return "error: missing 'body'";
    try {
      await this.jira.commentIssue(this.sessionId, key, body);
      return JSON.stringify({ ok: true });
    } catch (e) {
      return errString(e);
    }
  }
}

/** Build the Jira tools for a request bound to a session; [] when there's no session. */
export function jiraToolsFor(jira: JiraService, sessionId: string | undefined): AgentTool[] {
  if (!sessionId) return [];
  return [
    new JiraListSprintIssuesTool(jira, sessionId),
    new JiraGetIssueTool(jira, sessionId),
    new JiraCreateIssueTool(jira, sessionId),
    new JiraCommentTool(jira, sessionId),
  ];
}
