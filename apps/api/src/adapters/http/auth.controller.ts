import { Body, Controller, Get, HttpCode, HttpException, Post } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { z, ZodError } from "zod";
import { RedstoneService, RedstoneAuthError } from "../../application/redstone.service";
import { SettingsService } from "../../application/settings.service";

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
  ) {}

  /** Lets the login UI decide whether to offer the "Sign in with Redstone" option. */
  @Get("config")
  config() {
    return { redstone: this.redstone.enabled(), issuer: this.redstone.issuer() };
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
