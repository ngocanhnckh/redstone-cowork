import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AgencyService } from "../../application/agency.service";
import { JiraService } from "../../application/jira.service";
import { AccountsService } from "../../application/accounts.service";
import { InstanceTokenGuard, type GuardedRequest } from "./instance-token.guard";
import type { AgencyAttachment } from "../../domain/agency/agency-message.port";

/** Agency endpoints — org chat, agent DMs, gamified Jira stats + the agent's missions.
 *  All require a real agent account (the org chat is a person space, not automation). */
@Controller("agency")
@UseGuards(InstanceTokenGuard)
export class AgencyController {
  constructor(
    private readonly agency: AgencyService,
    private readonly jira: JiraService,
    private readonly accounts: AccountsService,
  ) {}

  private requireAgent(req: GuardedRequest) {
    if (req.authKind !== "account" || !req.account) throw new ForbiddenException("sign in as an agent");
    return req.account;
  }

  private attachments(body: unknown): AgencyAttachment[] {
    const raw = (body as { attachments?: unknown })?.attachments;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a): a is AgencyAttachment => !!a && typeof a === "object" && typeof (a as AgencyAttachment).url === "string")
      .slice(0, 10)
      .map((a) => ({ name: String(a.name ?? "file"), url: String(a.url), size: Number(a.size ?? 0), mime: String(a.mime ?? "") }));
  }

  // ---- Org channel ------------------------------------------------------
  @Get("chat")
  listOrg(@Req() req: GuardedRequest, @Query("afterId") afterId?: string) {
    this.requireAgent(req);
    return this.agency.listOrg(afterId);
  }

  @Post("chat")
  @HttpCode(200)
  postOrg(@Req() req: GuardedRequest, @Body() body: { body?: string; attachments?: unknown }) {
    const agent = this.requireAgent(req);
    return this.agency.postOrg(agent, String(body?.body ?? ""), this.attachments(body));
  }

  // ---- Direct messages --------------------------------------------------
  @Get("dm")
  threads(@Req() req: GuardedRequest) {
    return this.agency.threads(this.requireAgent(req));
  }

  @Get("dm/:accountId")
  listDm(@Req() req: GuardedRequest, @Param("accountId") accountId: string, @Query("afterId") afterId?: string) {
    return this.agency.listDm(this.requireAgent(req), accountId, afterId);
  }

  @Post("dm/:accountId")
  @HttpCode(200)
  postDm(@Req() req: GuardedRequest, @Param("accountId") accountId: string, @Body() body: { body?: string; attachments?: unknown }) {
    const agent = this.requireAgent(req);
    return this.agency.postDm(agent, accountId, String(body?.body ?? ""), this.attachments(body));
  }

  // ---- Gamified Jira stats + the agent's missions -----------------------
  /** Per-agent Jira workload counts (completed / in-progress / todo) for the Arena. */
  @Get("jira-stats")
  async jiraStats(@Req() req: GuardedRequest) {
    this.requireAgent(req);
    const roster = (await this.accounts.list()).filter((a) => a.jira);
    return this.jira.rosterStats(roster.map((a) => ({ accountId: a.id, jiraUser: a.jira })));
  }

  /** The CURRENT agent's assigned Jira issues (missions), newest first. */
  @Get("missions")
  async missions(@Req() req: GuardedRequest) {
    const agent = this.requireAgent(req);
    return this.jira.assignedIssues(agent.jira ?? "");
  }
}
