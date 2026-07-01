import { Injectable } from "@nestjs/common";
import { loadConfig, redstoneEnabled, type AppConfig } from "../infrastructure/config";

/** Identity resolved from a Redstone access token (via introspect/userinfo). */
export type RedstoneUser = {
  sub: string;
  username: string | null;
  email: string | null;
  isAdmin: boolean;
};

/** OAuth2 token set returned by the Redstone token endpoint. */
export type RedstoneTokens = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
  scope: string | null;
};

export class RedstoneAuthError extends Error {
  constructor(public readonly httpStatus: number, public readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Redstone acts as this instance's OIDC identity provider (org mode). This service
 * owns every call to the Redstone agent's OAuth2 + resource API: exchanging user
 * credentials for tokens (password grant), refreshing, verifying an access token
 * (introspect, cached), and — for the cockpit assistant — talking to the Redstone
 * agent AS the authenticated user to gather their Mattermost/Gmail/Jira context.
 *
 * Endpoint URLs are built from REDSTONE_ISSUER directly; the discovery document is
 * deliberately NOT trusted (its URLs can be misconfigured to localhost). All auth
 * is client_secret_post (client_id + client_secret as form fields).
 */
@Injectable()
export class RedstoneService {
  /** token -> {user, expiresAtMs}. Short TTL cache so we don't introspect every request. */
  private readonly verifyCache = new Map<string, { user: RedstoneUser | null; expiresAt: number }>();
  private static readonly VERIFY_TTL_MS = 60_000;
  private static readonly MAX_CACHE = 500;

  constructor(
    private readonly cfg: AppConfig = loadConfig(),
    private readonly fetchImpl: typeof fetch = (...a: Parameters<typeof fetch>) => fetch(...a),
    private readonly now: () => number = () => Date.now(),
  ) {}

  enabled(): boolean {
    return redstoneEnabled(this.cfg);
  }

  issuer(): string | null {
    return this.cfg.REDSTONE_ISSUER ?? null;
  }

  private oauthUrl(path: string): string {
    return `${this.cfg.REDSTONE_ISSUER}/api/v1/oauth2${path}`;
  }
  private meUrl(path: string): string {
    return `${this.cfg.REDSTONE_ISSUER}/api/v1/me${path}`;
  }

  private clientForm(): Record<string, string> {
    return { client_id: this.cfg.REDSTONE_CLIENT_ID!, client_secret: this.cfg.REDSTONE_CLIENT_SECRET! };
  }

  private async postForm(url: string, fields: Record<string, string>, timeoutMs = 20_000): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(fields).toString(),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private assertEnabled(): void {
    if (!this.enabled()) throw new RedstoneAuthError(404, "not_configured", "Redstone login is not enabled on this instance.");
  }

  private static toTokens(j: Record<string, unknown>): RedstoneTokens {
    return {
      access_token: String(j.access_token ?? ""),
      refresh_token: j.refresh_token ? String(j.refresh_token) : null,
      expires_in: Number(j.expires_in ?? 0),
      token_type: String(j.token_type ?? "Bearer"),
      scope: j.scope ? String(j.scope) : null,
    };
  }

  /** Exchange a user's Redstone username + password for tokens (password grant). */
  async login(username: string, password: string, scope?: string): Promise<{ tokens: RedstoneTokens; user: RedstoneUser }> {
    this.assertEnabled();
    const res = await this.postForm(this.oauthUrl("/token"), {
      grant_type: "password",
      username,
      password,
      ...(scope ? { scope } : {}),
      ...this.clientForm(),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new RedstoneAuthError(res.status, String(j.error ?? "invalid_grant"), String(j.error_description ?? "Redstone sign-in failed."));
    }
    const tokens = RedstoneService.toTokens(j);
    if (!tokens.access_token) throw new RedstoneAuthError(502, "invalid_response", "Redstone returned no access token.");
    // Resolve identity from the freshly-minted token (also confirms it works).
    const user = (await this.verify(tokens.access_token)) ?? { sub: username, username, email: null, isAdmin: false };
    return { tokens, user };
  }

  /** Exchange a refresh token for a fresh access token. */
  async refresh(refreshToken: string): Promise<RedstoneTokens> {
    this.assertEnabled();
    const res = await this.postForm(this.oauthUrl("/token"), {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      ...this.clientForm(),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new RedstoneAuthError(res.status, String(j.error ?? "invalid_grant"), String(j.error_description ?? "Could not refresh the Redstone session."));
    }
    return RedstoneService.toTokens(j);
  }

  /**
   * Resolve + validate an access token via introspection, cached briefly. Returns
   * the user on an active token, or null if inactive/unknown. Never throws — a
   * transient Redstone outage returns null (treated as unauthenticated) rather than
   * 500-ing every guarded request.
   */
  async verify(accessToken: string): Promise<RedstoneUser | null> {
    if (!this.enabled() || !accessToken) return null;
    const cached = this.verifyCache.get(accessToken);
    if (cached && cached.expiresAt > this.now()) return cached.user;

    let user: RedstoneUser | null = null;
    try {
      const res = await this.postForm(this.oauthUrl("/introspect"), { token: accessToken, ...this.clientForm() });
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (j.active === true && j.sub) {
          user = {
            sub: String(j.sub),
            username: j.username ? String(j.username) : j.preferred_username ? String(j.preferred_username) : null,
            email: j.email ? String(j.email) : null,
            isAdmin: j.redstone_is_admin === true,
          };
        }
      }
    } catch {
      // transient — cache the miss briefly so we don't hammer a struggling issuer
      user = null;
    }
    this.cacheVerify(accessToken, user);
    return user;
  }

  private cacheVerify(token: string, user: RedstoneUser | null): void {
    if (this.verifyCache.size >= RedstoneService.MAX_CACHE) {
      // cheap eviction: clear the whole cache when it grows too big
      this.verifyCache.clear();
    }
    this.verifyCache.set(token, { user, expiresAt: this.now() + RedstoneService.VERIFY_TTL_MS });
  }

  /**
   * Ask the Redstone agent a question AS the user (its memory + integrations +
   * tools). Pass a prior sessionId to continue the same agent workspace. Blocking,
   * can take a while for tool-heavy asks.
   */
  async askAgent(accessToken: string, message: string, sessionId?: string): Promise<{ sessionId: string | null; reply: string }> {
    this.assertEnabled();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const res = await this.fetchImpl(this.meUrl("/agent/messages"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(sessionId ? { message, session_id: sessionId } : { message }),
        signal: ctrl.signal,
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new RedstoneAuthError(res.status, "agent_error", String(j.error ?? `Redstone agent error (${res.status}).`));
      return { sessionId: j.session_id ? String(j.session_id) : null, reply: String(j.reply ?? "") };
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET a `/api/v1/me/...` resource as the user (integrations, inbox, gmail, jira, sessions). */
  async fetchResource(accessToken: string, path: string): Promise<unknown> {
    this.assertEnabled();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await this.fetchImpl(this.meUrl(path), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new RedstoneAuthError(res.status, "resource_error", `Redstone resource error (${res.status}).`);
      return await res.json().catch(() => ({}));
    } finally {
      clearTimeout(timer);
    }
  }
}
