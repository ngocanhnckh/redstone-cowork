import type { Connection } from "@rcw/shared";
import type { ConnectionsService } from "./connections.service";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com";

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
};

/**
 * Runs the in-app Google OAuth consent dance. `buildAuthUrl` produces the consent
 * link (offline access so we get a refresh token); `exchangeAndConnect` swaps the
 * returned code for a refresh token and hands it to ConnectionsService.create as a
 * `google` connection — reusing the same validation/encryption path as PAT connectors.
 */
export class GoogleOAuthService {
  private readonly fetchImpl: typeof fetch;
  constructor(
    private readonly cfg: GoogleOAuthConfig,
    private readonly connections: Pick<ConnectionsService, "create">,
  ) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent", // force a refresh token even on re-consent
      include_granted_scopes: "true",
      scope: SCOPES.join(" "),
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeAndConnect(code: string): Promise<Connection> {
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.cfg.redirectUri,
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Google code exchange failed (${res.status})`);
    const data = (await res.json()) as { refresh_token?: string; id_token?: string };
    if (!data.refresh_token) {
      throw new Error("Google did not return a refresh token — revoke prior access and re-consent");
    }
    const email = emailFromIdToken(data.id_token) ?? "google account";
    return this.connections.create({
      kind: "google",
      endpoint: API_BASE,
      token: data.refresh_token,
      label: email,
      config: { scopes: SCOPES, email },
    });
  }
}

/** Decode the email claim from a JWT id_token without verifying it (we just obtained it from Google over TLS). */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}
