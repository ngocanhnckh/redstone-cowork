import { randomUUID } from "node:crypto";
import { Body, Controller, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ACCOUNT_STORE, type AccountStore } from "../../domain/accounts/account-store.port";
import { Inject } from "@nestjs/common";

// Inbound Jira DC webhook → per-agent IN-APP notifications.
//
// Configure ONE webhook in Jira (shared org server):
//   System → WebHooks → URL: https://cowork.chatredstone.com/hooks/jira?secret=<JIRA_WEBHOOK_SECRET>
//   Events: issue created / updated / assigned (+ comments).
//
// On each event we find the roster agent whose `jira` username matches the issue's
// assignee (ANY project — not locked to one) and record a notification. The agent's
// app polls /accounts/me/jira-notifications and shows a futuristic alert. Best-effort:
// Jira always gets its 200 so it never retry-storms us.

type JiraWebhook = {
  webhookEvent?: string;
  issue_event_type_name?: string;
  user?: { name?: string; displayName?: string };
  issue?: {
    key?: string;
    fields?: {
      summary?: string;
      status?: { name?: string };
      assignee?: { name?: string } | null;
    };
  };
};

@Controller("hooks")
export class JiraHooksController {
  constructor(@Inject(ACCOUNT_STORE) private readonly accounts: AccountStore) {}

  @Post("jira")
  @HttpCode(200)
  async jira(@Query("secret") secret: string | undefined, @Body() body: JiraWebhook) {
    const expect = process.env.JIRA_WEBHOOK_SECRET;
    if (!expect || secret !== expect) throw new UnauthorizedException();

    const assignee = body.issue?.fields?.assignee?.name;
    if (!assignee) return { ok: true, notified: false };

    const agent = await this.accounts.findByJiraUsername(assignee);
    if (!agent || agent.disabledAt) return { ok: true, notified: false };

    const key = body.issue?.key ?? "";
    const base = (process.env.JIRA_OAUTH_BASE_URL ?? "").replace(/\/$/, "");
    await this.accounts.addJiraNotification({
      id: randomUUID(),
      accountId: agent.id,
      issueKey: key,
      summary: body.issue?.fields?.summary ?? "",
      event: body.issue_event_type_name ?? body.webhookEvent ?? "updated",
      status: body.issue?.fields?.status?.name ?? "",
      actor: body.user?.displayName ?? body.user?.name ?? "",
      url: base && key ? `${base}/browse/${key}` : "",
      createdAt: new Date(),
      seenAt: null,
    });
    return { ok: true, notified: true, agent: agent.username };
  }
}
