import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { ScoringProjectConfigPatch } from "@rcw/shared";
import { ScoringService } from "../../application/scoring.service";
import { JiraScannerService } from "../../application/scoring/jira-scanner.service";
import { InstanceTokenGuard, type GuardedRequest } from "./instance-token.guard";

/**
 * Scoring endpoints — the per-project effort leaderboard, an agent's own standing + history, the
 * Agent-of-the-Week award, and admin config/targets/critical-tasks + the voidable penalty ledger.
 * Agent routes need a signed-in account; /admin routes additionally require role === "admin".
 */
@Controller("scoring")
@UseGuards(InstanceTokenGuard)
export class ScoringController {
  constructor(
    private readonly scoring: ScoringService,
    private readonly scanner: JiraScannerService,
  ) {}

  private requireAgent(req: GuardedRequest) {
    if (req.authKind !== "account" || !req.account) throw new ForbiddenException("sign in as an agent");
    return req.account;
  }
  private requireAdmin(req: GuardedRequest) {
    const agent = this.requireAgent(req);
    if (agent.role !== "admin") throw new ForbiddenException("admin only");
    return agent;
  }

  // ---- agent-facing ----------------------------------------------------
  @Get("board")
  board(@Req() req: GuardedRequest, @Query("project") project: string, @Query("week") week?: string) {
    this.requireAgent(req);
    return this.scoring.board(project, week || undefined);
  }

  @Get("my")
  my(@Req() req: GuardedRequest, @Query("project") project?: string) {
    const agent = this.requireAgent(req);
    return this.scoring.myScore(agent, project || undefined);
  }

  @Get("history")
  history(@Req() req: GuardedRequest, @Query("project") project?: string) {
    const agent = this.requireAgent(req);
    return this.scoring.history(agent, project || undefined);
  }

  @Get("projects")
  projects(@Req() req: GuardedRequest) {
    this.requireAgent(req);
    return this.scoring.projects();
  }

  @Get("agent-week")
  agentWeek(@Req() req: GuardedRequest) {
    this.requireAgent(req);
    return this.scoring.agentWeekAward();
  }

  // ---- admin -----------------------------------------------------------
  @Get("admin/configs")
  listConfigs(@Req() req: GuardedRequest) {
    this.requireAdmin(req);
    return this.scoring.listConfigs();
  }

  @Get("admin/config/:project")
  getConfig(@Req() req: GuardedRequest, @Param("project") project: string) {
    this.requireAdmin(req);
    return this.scoring.getConfig(project);
  }

  @Post("admin/config/:project")
  @HttpCode(200)
  setConfig(@Req() req: GuardedRequest, @Param("project") project: string, @Body() patch: ScoringProjectConfigPatch) {
    const admin = this.requireAdmin(req);
    return this.scoring.upsertConfig(project, patch ?? {}, admin.id);
  }

  @Post("admin/targets")
  @HttpCode(200)
  setTargets(@Req() req: GuardedRequest, @Body() body: { projectKey: string; weekKey: string; teamTarget?: number; individualTarget?: number }) {
    this.requireAdmin(req);
    return this.scoring.setTargets({
      projectKey: body.projectKey, weekKey: body.weekKey,
      teamTarget: Number(body.teamTarget ?? 0), individualTarget: Number(body.individualTarget ?? 0),
    });
  }

  @Get("admin/sprint-issues")
  sprintIssues(@Req() req: GuardedRequest, @Query("project") project: string) {
    this.requireAdmin(req);
    return this.scoring.sprintIssues(project);
  }

  @Get("admin/critical")
  getCritical(@Req() req: GuardedRequest, @Query("project") project: string, @Query("week") week: string) {
    this.requireAdmin(req);
    return this.scoring.getCritical(project, week);
  }

  @Post("admin/critical")
  @HttpCode(200)
  setCritical(@Req() req: GuardedRequest, @Body() body: { projectKey: string; weekKey: string; issueKeys?: string[] }) {
    const admin = this.requireAdmin(req);
    return this.scoring.setCritical(body.projectKey, body.weekKey, Array.isArray(body.issueKeys) ? body.issueKeys : [], admin.id);
  }

  @Get("admin/penalties")
  penalties(@Req() req: GuardedRequest, @Query("project") project: string, @Query("includeVoided") includeVoided?: string) {
    this.requireAdmin(req);
    return this.scoring.listPenalties(project, includeVoided === "1" || includeVoided === "true");
  }

  @Post("admin/penalties/:id/void")
  @HttpCode(200)
  async voidPenalty(@Req() req: GuardedRequest, @Param("id") id: string) {
    const admin = this.requireAdmin(req);
    return { ok: await this.scoring.voidPenalty(id, admin.id) };
  }

  @Post("admin/scan/:project")
  @HttpCode(200)
  async scan(@Req() req: GuardedRequest, @Param("project") project: string) {
    this.requireAdmin(req);
    const cfg = await this.scoring.getConfig(project);
    return this.scanner.scanProject(cfg, new Date(), true);
  }
}
