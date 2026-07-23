import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Account, AccountSession } from "@rcw/shared";
import { ACCOUNT_STORE, type AccountStore } from "../domain/accounts/account-store.port";
import { AccountsService, type LoginContext } from "./accounts.service";
import { CredentialCipher } from "../infrastructure/credential-cipher";

// ——— Jira Data Center OAuth 2.0 (incoming link) sign-in ———
//
// Employees authenticate against the org's Jira. We run authorization-code + PKCE,
// exchange the code for a Jira access token, identify the user via /myself, upsert
// their cowork account (matched by Jira username), mint a long-lived Jira Personal
// Access Token AS them, store it encrypted, and issue the normal rcwa_ session.
//
// The desktop can't receive the browser redirect directly (the redirect URI is the
// fixed server callback registered in Jira), so we bridge with a short-lived state:
// start() → browser → callback() stashes the result under `state` → poll() drains it.

type PendingAuth = { verifier: string; createdAt: number; redirectTo?: string };
type Ready = { session: AccountSession | null; error: string | null; at: number; redirectTo?: string };

const TTL_MS = 10 * 60_000;

export class JiraOAuthError extends Error {}

@Injectable()
export class JiraOAuthService {
  private pending = new Map<string, PendingAuth>(); // state → PKCE verifier
  private ready = new Map<string, Ready>(); // state → outcome (drained by poll)
  private fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a);

  constructor(
    @Inject(ACCOUNT_STORE) private readonly store: AccountStore,
    private readonly accounts: AccountsService,
    private readonly cipher: CredentialCipher,
  ) {}

  setFetch(f: typeof fetch): void {
    this.fetchImpl = f;
  }

  enabled(): boolean {
    return !!(this.baseUrl() && process.env.JIRA_OAUTH_CLIENT_ID && process.env.JIRA_OAUTH_CLIENT_SECRET);
  }

  private baseUrl(): string {
    return (process.env.JIRA_OAUTH_BASE_URL ?? "").replace(/\/$/, "");
  }

  private redirectUri(): string {
    return process.env.JIRA_OAUTH_REDIRECT ?? "https://cowork.chatredstone.com/auth/jira/callback";
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.createdAt > TTL_MS) this.pending.delete(k);
    for (const [k, v] of this.ready) if (now - v.at > TTL_MS) this.ready.delete(k);
  }

  /** Begin sign-in: returns the Jira authorize URL + a state the client polls on.
   *  redirectTo (web flow) makes the callback 302 back to the web finish route with
   *  the state instead of rendering the desktop "return to app" page + poll. */
  start(redirectTo?: string): { authUrl: string; state: string } {
    if (!this.enabled()) throw new JiraOAuthError("Jira OAuth not configured");
    this.sweep();
    const state = randomBytes(16).toString("hex");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    this.pending.set(state, { verifier, createdAt: Date.now(), redirectTo });
    const u = new URL(`${this.baseUrl()}/rest/oauth2/latest/authorize`);
    u.searchParams.set("client_id", process.env.JIRA_OAUTH_CLIENT_ID!);
    u.searchParams.set("redirect_uri", this.redirectUri());
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", process.env.JIRA_OAUTH_SCOPE ?? "WRITE");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    return { authUrl: u.toString(), state };
  }

  /** Handle the Jira redirect. Resolves the sign-in and stashes it under `state`. */
  async handleCallback(code: string, state: string, ctx: LoginContext): Promise<void> {
    const pend = this.pending.get(state);
    this.pending.delete(state);
    try {
      if (!pend) throw new JiraOAuthError("expired or unknown sign-in request");
      const accessToken = await this.exchangeCode(code, pend.verifier);
      const me = await this.jiraMyself(accessToken);
      const jiraUser = me.name;
      if (!jiraUser) throw new JiraOAuthError("Jira did not return a username");

      // Match existing account by Jira username; otherwise provision a member.
      let account: Account | null = await this.store.findByJiraUsername(jiraUser);
      if (!account) {
        account = await this.accounts.create({
          username: this.safeUsername(jiraUser),
          password: randomBytes(24).toString("base64url"), // random — they sign in via Jira/face, not this
          displayName: me.displayName || jiraUser,
          role: "member",
          jira: jiraUser,
          email: me.emailAddress ?? "",
        });
      }
      if (account.disabledAt) throw new JiraOAuthError("account is disabled");

      // Mint a Jira PAT AS the user and store it encrypted for their sessions.
      const pat = await this.mintPat(accessToken);
      if (pat) {
        const enc = this.cipher.isConfigured() ? this.cipher.encrypt(pat) : pat;
        await this.store.setJiraCredentials(account.id, this.baseUrl(), enc);
      }

      const session = await this.accounts.issueSession(account, { ...ctx, method: "jira-oauth" });
      this.ready.set(state, { session, error: null, at: Date.now(), redirectTo: pend?.redirectTo });
    } catch (e) {
      this.ready.set(state, { session: null, error: e instanceof Error ? e.message : "sign-in failed", at: Date.now(), redirectTo: pend?.redirectTo });
    }
  }

  /** Drain the outcome for a state (one-shot, for the desktop). null = still pending. */
  poll(state: string): { status: "pending" } | { status: "ok"; session: AccountSession } | { status: "error"; error: string } {
    this.sweep();
    const r = this.ready.get(state);
    if (!r) return { status: "pending" };
    this.ready.delete(state);
    return r.session ? { status: "ok", session: r.session } : { status: "error", error: r.error ?? "sign-in failed" };
  }

  /** The web finish redirect target for a completed flow, if it was a web start. */
  redirectFor(state: string): string | null {
    return this.ready.get(state)?.redirectTo ?? null;
  }

  /** Non-draining read for the browser callback page (leaves the token for the desktop poll). */
  peek(state: string): { ok: boolean; error: string | null } {
    const r = this.ready.get(state);
    if (!r) return { ok: false, error: "sign-in did not complete" };
    return { ok: !!r.session, error: r.error };
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl()}/rest/oauth2/latest/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.JIRA_OAUTH_CLIENT_ID!,
        client_secret: process.env.JIRA_OAUTH_CLIENT_SECRET!,
        redirect_uri: this.redirectUri(),
        code,
        code_verifier: verifier,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
    if (!res.ok || !j.access_token) throw new JiraOAuthError(j.error_description ?? `token exchange failed (HTTP ${res.status})`);
    return j.access_token;
  }

  private async jiraMyself(accessToken: string): Promise<{ name?: string; displayName: string; emailAddress?: string }> {
    const res = await this.fetchImpl(`${this.baseUrl()}/rest/api/2/myself`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new JiraOAuthError(`could not read Jira profile (HTTP ${res.status})`);
    return (await res.json()) as { name?: string; displayName: string; emailAddress?: string };
  }

  /** Create a Personal Access Token via the Jira DC PAT API (best-effort). */
  private async mintPat(accessToken: string): Promise<string | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl()}/rest/pat/latest/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Redstone Cowork (${new Date().toISOString().slice(0, 10)})`, expirationDuration: 90 }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { rawToken?: string };
      return j.rawToken ?? null;
    } catch {
      return null;
    }
  }

  private safeUsername(jira: string): string {
    const base = jira.toLowerCase().replace(/[^a-z0-9._-]/g, ".").replace(/^[^a-z0-9]+/, "") || "agent";
    return base.length >= 2 ? base : `agent.${base}`;
  }
}
