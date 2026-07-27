import { Body, Controller, ForbiddenException, HttpCode, Post, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { MailService } from "../../application/mail.service";
import { InstanceTokenGuard, type GuardedRequest } from "./instance-token.guard";

/** Receives a debug log + context from the desktop's "Report a problem" button and emails it to
 *  the dev inbox (REPORT_EMAIL). Requires a signed-in agent so reports are attributable and the
 *  endpoint can't be spammed anonymously. */
@Controller("report-bug")
@UseGuards(InstanceTokenGuard)
export class ReportController {
  constructor(private readonly mail: MailService) {}

  @Post()
  @HttpCode(200)
  async report(@Req() req: GuardedRequest, @Body() body: { message?: string; log?: string; context?: Record<string, unknown> }) {
    if (req.authKind !== "account" || !req.account) throw new ForbiddenException("sign in to report a problem");
    if (!this.mail.isConfigured()) {
      throw new ServiceUnavailableException("email isn't configured on the server (set SMTP_HOST/USER/PASS/FROM in the server .env)");
    }
    const agent = req.account;
    const fromLabel = `${agent.displayName || agent.username} (@${agent.username})`;
    const context = {
      account: agent.username,
      role: agent.role,
      ...(body.context ?? {}),
      reportedAt: new Date().toISOString(),
    };
    const { to } = await this.mail.sendBugReport({
      fromLabel,
      message: String(body.message ?? "").slice(0, 4000),
      log: String(body.log ?? "").slice(0, 500_000), // cap the attachment
      context,
    });
    return { ok: true, to };
  }
}
