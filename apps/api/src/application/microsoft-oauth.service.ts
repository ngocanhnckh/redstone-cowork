import type { Connection } from "@rcw/shared";
import type { ConnectionsService } from "./connections.service";

// Common endpoint — works for both personal and work/school Microsoft accounts.
const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const API_BASE = "https://graph.microsoft.com";

const SCOPES = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Read", "Calendars.Read"];

export type MicrosoftOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
};

/**
 * Runs the in-app Microsoft (Outlook) OAuth consent dance — mirror of the Google
 * service. `buildAuthUrl` produces the consent link (offline_access for a refresh
 * token); `exchangeAndConnect` swaps the code for a refresh token and hands it to
 * ConnectionsService.create as a `microsoft` connection.
 */
export class MicrosoftOAuthService {
  private readonly fetchImpl: typeof fetch;
  constructor(
    private readonly cfg: MicrosoftOAuthConfig,
    private readonly connections: Pick<ConnectionsService, "create">,
  ) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      response_mode: "query",
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
      scope: SCOPES.join(" "),
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Microsoft code exchange failed (${res.status})`);
    const data = (await res.json()) as { refresh_token?: string; id_token?: string };
    if (!data.refresh_token) {
      throw new Error("Microsoft did not return a refresh token — ensure offline_access was granted");
    }
    const email = emailFromIdToken(data.id_token) ?? "outlook account";
    return this.connections.create({
      kind: "microsoft",
      endpoint: API_BASE,
      token: data.refresh_token,
      label: email,
      config: { scopes: SCOPES, email },
    });
  }
}

/** Decode the email/upn claim from a JWT id_token without verifying it (obtained from Microsoft over TLS). */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { email?: string; preferred_username?: string };
    return claims.email ?? claims.preferred_username ?? null;
  } catch {
    return null;
  }
}
