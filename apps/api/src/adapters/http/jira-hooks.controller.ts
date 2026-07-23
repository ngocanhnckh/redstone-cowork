import { Body, Controller, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";
import { AccountsService } from "../../application/accounts.service";

// Inbound Jira DC webhook → per-agent mission notifications.
//
// Configure in Jira: System → WebHooks → Create, URL:
//   https://cowork.chatredstone.com/hooks/jira?secret=<JIRA_WEBHOOK_SECRET>
// Events: issue created / updated / assigned (+ comments if wanted). Jira DC can't
// send custom auth headers, so the shared secret rides the query string (standard
// DC practice) and is compared against the server env.
//
// On each event we look up the roster agent whose `jira` username matches the
// issue's assignee and POST a compact JSON notification to their personal
// `webhook` URL (set by the admin in the Agent Roster). Best-effort: failures are
// swallowed — Jira must never see an error and retry-storm us.

type JiraWebhook = {
  webhookEvent?: string;
  issue_event_type_name?: string;
  user?: { name?: string; displayName?: string };
  issue?: {
    key?: string;
    fields?: {
      summary?: string;
      status?: { name?: string };
      priority?: { name?: string };
      assignee?: { name?: string; displayName?: string } | null;
      reporter?: { name?: string; displayName?: string } | null;
      project?: { key?: string; name?: string };
    };
  };
  comment?: { body?: string; author?: { name?: string; displayName?: string } };
};

@Controller("hooks")
export class JiraHooksController {
  constructor(private readonly accounts: AccountsService) {}

  @Post("jira")
  @HttpCode(200)
  async jira(@Query("secret") secret: string | undefined, @Body() body: JiraWebhook) {
    const expect = process.env.JIRA_WEBHOOK_SECRET;
    if (!expect || secret !== expect) throw new UnauthorizedException();

    const assignee = body.issue?.fields?.assignee?.name;
    if (!assignee) return { ok: true, forwarded: false }; // nothing to route

    const agent = (await this.accounts.list()).find(
      (a) => !a.disabledAt && a.jira && a.jira.toLowerCase() === assignee.toLowerCase(),
    );
    if (!agent?.webhook) return { ok: true, forwarded: false };

    const f = body.issue?.fields;
    const note = {
      source: "redstone-cowork",
      kind: "jira",
      event: body.webhookEvent ?? "unknown",
      eventDetail: body.issue_event_type_name ?? null,
      issue: body.issue?.key ?? null,
      summary: f?.summary ?? null,
      status: f?.status?.name ?? null,
      priority: f?.priority?.name ?? null,
      project: f?.project?.key ?? null,
      actor: body.user?.displayName ?? body.user?.name ?? null,
      comment: body.comment?.body?.slice(0, 500) ?? null,
      agent: agent.username,
      text: `🎯 MISSION UPDATE [${body.issue?.key}] ${f?.summary ?? ""} — ${body.issue_event_type_name ?? body.webhookEvent ?? "event"}${f?.status?.name ? ` · ${f.status.name}` : ""}`,
    };

    // Fire-and-forget with a hard timeout; Jira gets its 200 immediately.
    void this.forward(agent.webhook, note);
    return { ok: true, forwarded: true };
  }

  private async forward(url: string, payload: unknown): Promise<void> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      }).catch(() => {});
      clearTimeout(t);
    } catch {
      /* personal webhook down — drop silently */
    }
  }
}
