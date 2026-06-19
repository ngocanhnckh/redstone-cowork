import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GoogleOAuthService } from "../../application/google-oauth.service";
import { MicrosoftOAuthService } from "../../application/microsoft-oauth.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("oauth/google")
@UseGuards(InstanceTokenGuard)
export class OAuthController {
  constructor(private readonly google: GoogleOAuthService) {}

  /** Returns the Google consent URL for the web layer to redirect the browser to. */
  @Get("url")
  url() {
    return { url: this.google.buildAuthUrl(randomUUID()) };
  }

  /** Exchanges the code from Google's redirect and creates the google connection. */
  @Post("callback")
  @HttpCode(200)
  async callback(@Body() body: { code?: string }) {
    if (!body?.code) throw new BadRequestException("missing code");
    try {
      return await this.google.exchangeAndConnect(body.code);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "oauth exchange failed");
    }
  }
}

@Controller("oauth/microsoft")
@UseGuards(InstanceTokenGuard)
export class MicrosoftOAuthController {
  constructor(private readonly microsoft: MicrosoftOAuthService) {}

  /** Returns the Microsoft consent URL for the web layer to redirect the browser to. */
  @Get("url")
  url() {
    return { url: this.microsoft.buildAuthUrl(randomUUID()) };
  }

  /** Exchanges the code from Microsoft's redirect and creates the microsoft connection. */
  @Post("callback")
  @HttpCode(200)
  async callback(@Body() body: { code?: string }) {
    if (!body?.code) throw new BadRequestException("missing code");
    try {
      return await this.microsoft.exchangeAndConnect(body.code);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "oauth exchange failed");
    }
  }
}
