import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InstanceTokenGuard, type GuardedRequest } from "./instance-token.guard";
import { MailService } from "../../application/mail.service";
import { BUG_REPORT_STORE, type BugReportStore } from "../../domain/reports/bug-report.port";

/**
 * Problem reports from the desktop app.
 *
 * These used to REQUIRE email: with no SMTP configured the endpoint returned 503 and
 * the report was thrown away, losing the log the user had just taken the trouble to
 * send. Reports are now persisted here first — the durable record — and email is a
 * best-effort notification on top, so a mail outage can never lose a report.
 */
@Controller("report-bug")
@UseGuards(InstanceTokenGuard)
export class ReportController {
  constructor(
    private readonly mail: MailService,
    @Inject(BUG_REPORT_STORE) private readonly store: BugReportStore,
  ) {}

  @Post()
  @HttpCode(200)
  async report(@Req() req: GuardedRequest, @Body() body: { message?: string; log?: string; context?: Record<string, unknown> }) {
    if (req.authKind !== "account" || !req.account) throw new ForbiddenException("sign in to report a problem");
    const agent = req.account;
    const context = {
      account: agent.username,
      role: agent.role,
      ...(body.context ?? {}),
      reportedAt: new Date().toISOString(),
    };
    const saved = await this.store.create({
      id: randomUUID(),
      accountId: agent.id ?? null,
      username: agent.username,
      message: String(body.message ?? "").slice(0, 4000),
      log: String(body.log ?? "").slice(0, 500_000), // cap the attached log
      context,
      status: "open",
      createdAt: new Date(),
    });

    // Notification only. A mail failure must not fail the request — the report is
    // already stored, and telling the user it failed would invite a pointless retry.
    let emailed: string | null = null;
    if (this.mail.isConfigured()) {
      try {
        const { to } = await this.mail.sendBugReport({
          fromLabel: `${agent.displayName || agent.username} (@${agent.username})`,
          message: saved.message,
          log: saved.log,
          context,
        });
        emailed = to ?? null;
      } catch { /* stored anyway */ }
    }
    return { ok: true, id: saved.id, emailed };
  }

  /** Triage list (admins only). */
  @Get()
  async list(@Req() req: GuardedRequest, @Query("status") status?: string, @Query("limit") limit?: string) {
    this.requireAdmin(req);
    const rows = await this.store.list({
      status: status === "open" || status === "closed" ? status : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    // The log can be huge — the list view sends a preview, not the whole thing.
    return rows.map((r) => ({ ...r, log: r.log.slice(0, 2000), logBytes: r.log.length }));
  }

  @Patch(":id")
  async setStatus(@Req() req: GuardedRequest, @Param("id") id: string, @Body() body: { status?: string }) {
    this.requireAdmin(req);
    await this.store.setStatus(id, body?.status === "closed" ? "closed" : "open");
    return { ok: true };
  }

  private requireAdmin(req: GuardedRequest) {
    if (req.authKind !== "account" || req.account?.role !== "admin") throw new ForbiddenException("admin only");
  }
}
