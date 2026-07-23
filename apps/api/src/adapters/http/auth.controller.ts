import { Body, Controller, Get, HttpCode, HttpException, Post, Req, UnauthorizedException } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import { z, ZodError } from "zod";
import { AccountLoginSchema } from "@rcw/shared";
import { AccountAuthError, AccountsService } from "../../application/accounts.service";
import { RedstoneService, RedstoneAuthError } from "../../application/redstone.service";
import { SettingsService } from "../../application/settings.service";

/** Source IP for the login audit: first X-Forwarded-For hop (we sit behind the web
 *  proxy + cloudflared) falling back to the socket address. */
export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "";
}

/**
 * Public (unguarded) auth endpoints. Personal mode still authenticates with the
 * instance token directly (no endpoint needed). Org mode signs in through Redstone:
 * the browser/desktop posts the user's Redstone username + password here, we run
 * the password grant server-side (holding the client secret), and hand back the
 * Redstone access/refresh tokens the client then uses as its Bearer.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly redstone: RedstoneService,
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
  ) {}

  /** Lets the login UI decide which sign-in options to offer: Redstone org SSO,
   *  employee accounts (enterprise mode), and the branding to show. */
  @Get("config")
  async config() {
    const accountCount = await this.accounts.list().then((l) => l.length).catch(() => 0);
    return {
      redstone: this.redstone.enabled(),
      issuer: this.redstone.issuer(),
      accounts: accountCount > 0,
      orgName: process.env.ORG_NAME ?? null,
    };
  }

  /** Employee/admin account sign-in (enterprise mode). Every attempt — success or
   *  failure — lands in the login audit with source IP + device label. */
  @Post("account/login")
  @HttpCode(200)
  async accountLogin(@Body() body: unknown, @Req() req: Request) {
    try {
      const { username, password } = AccountLoginSchema.parse(body);
      const device = z.string().max(200).optional().catch(undefined).parse((body as Record<string, unknown>)?.device)
        ?? req.headers["user-agent"] ?? "";
      return await this.accounts.login(username, password, { ip: clientIp(req), device: String(device) });
    } catch (e) {
      if (e instanceof AccountAuthError) {
        throw new UnauthorizedException({ error: "invalid_credentials", error_description: "Wrong username or password." });
      }
      throw toHttp(e);
    }
  }

  @Post("redstone/login")
  @HttpCode(200)
  async login(@Body() body: unknown) {
    try {
      const { username, password, scope } = z
        .object({ username: z.string().min(1), password: z.string().min(1), scope: z.string().optional() })
        .parse(body);
      const { tokens, user } = await this.redstone.login(username, password, scope);
      // First org login binds this installation to that Redstone user (owner).
      await this.settings.claimOwnerIfUnset(user.sub);
      return { ...tokens, user };
    } catch (e) {
      throw toHttp(e);
    }
  }

  @Post("redstone/refresh")
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    try {
      const { refresh_token } = z.object({ refresh_token: z.string().min(1) }).parse(body);
      return await this.redstone.refresh(refresh_token);
    } catch (e) {
      throw toHttp(e);
    }
  }
}

/** Map service/validation errors to RFC 6749-shaped HTTP responses. */
function toHttp(e: unknown): HttpException {
  if (e instanceof ZodError) return new BadRequestException({ error: "invalid_request", error_description: e.issues[0]?.message ?? "invalid request" });
  if (e instanceof RedstoneAuthError) return new HttpException({ error: e.code, error_description: e.message }, e.httpStatus);
  return new HttpException({ error: "server_error", error_description: "Unexpected error." }, 500);
}
