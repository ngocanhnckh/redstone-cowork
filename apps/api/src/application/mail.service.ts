import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Minimal SMTP mail sender for bug reports. Configured entirely from env so no secrets live in
 * code: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_SECURE ("1" → TLS on
 * connect / port 465), SMTP_FROM (default SMTP_USER). Reports go to REPORT_EMAIL
 * (default anh.nguyen@yitec.group). If SMTP isn't configured, isConfigured() is false and the
 * controller returns a clear "email not configured" instead of pretending to send.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  private cfg() {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure = process.env.SMTP_SECURE === "1" || port === 465;
    const from = (process.env.SMTP_FROM || user || "").trim();
    const to = (process.env.REPORT_EMAIL || "anh.nguyen@yitec.group").trim();
    return { host, user, pass, port, secure, from, to };
  }

  isConfigured(): boolean {
    const c = this.cfg();
    return !!(c.host && c.user && c.pass && c.from);
  }

  private tx(): Transporter {
    if (this.transporter) return this.transporter;
    const c = this.cfg();
    this.transporter = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass } });
    return this.transporter;
  }

  /** Email a bug report + the attached debug log to the dev inbox. Returns the recipient. */
  async sendBugReport(input: { fromLabel: string; message: string; log: string; context: Record<string, unknown> }): Promise<{ to: string }> {
    const c = this.cfg();
    const ctxLines = Object.entries(input.context).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
    const body =
      `Bug report from ${input.fromLabel}\n\n` +
      `${input.message || "(no description)"}\n\n` +
      `---- context ----\n${ctxLines}\n\n` +
      `The full debug log is attached.`;
    await this.tx().sendMail({
      from: c.from,
      to: c.to,
      subject: `[Redstone Cowork] Problem report — ${input.fromLabel}`,
      text: body,
      attachments: input.log ? [{ filename: "redstone-debug.log", content: input.log }] : [],
    });
    return { to: c.to };
  }
}
