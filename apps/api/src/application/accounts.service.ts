import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Account, AccountProfilePatch, AccountSession, LoginAuditEntry, NewAccount } from "@rcw/shared";
import { ACCOUNT_STORE, type AccountStore } from "../domain/accounts/account-store.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";

// promisify() loses the options overload — wrap explicitly.
const scrypt = (password: string, salt: string, keylen: number, opts: ScryptOptions): Promise<Buffer> =>
  new Promise((res, rej) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? rej(err) : res(key))));

// scrypt parameters — OWASP-recommended interactive-login cost.
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hex] = parts;
  try {
    const key = await scrypt(password, salt, hex.length / 2, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    const expect = Buffer.from(hex, "hex");
    return key.length === expect.length && timingSafeEqual(key, expect);
  } catch {
    return false;
  }
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Context captured at the HTTP edge for the login audit trail. */
export type LoginContext = { ip?: string; device?: string; method?: string };

export class AccountAuthError extends Error {
  constructor(public readonly reason: "bad-credentials" | "disabled") {
    super(reason);
  }
}

@Injectable()
export class AccountsService implements OnModuleInit {
  constructor(
    @Inject(ACCOUNT_STORE) private readonly store: AccountStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  async onModuleInit(): Promise<void> {
    // Seeding must never block or crash boot — enterprise mode simply stays off
    // until ADMIN_USERNAME/ADMIN_PASSWORD are configured.
    try {
      await this.seedAdmin();
    } catch (e) {
      console.error("[accounts] seed failed:", e instanceof Error ? e.message : e);
    }
  }

  /** First-boot bootstrap: when no accounts exist and ADMIN_USERNAME/ADMIN_PASSWORD
   *  are set, create the admin account and claim every unowned session for it. Also
   *  claims strays on later boots (hook-attached sessions predating ownership). */
  async seedAdmin(): Promise<void> {
    const username = process.env.ADMIN_USERNAME?.trim();
    const password = process.env.ADMIN_PASSWORD;
    if ((await this.store.count()) === 0) {
      if (!username || !password) return; // enterprise mode not configured yet
      await this.store.create({
        id: randomUUID(),
        username,
        displayName: process.env.ADMIN_DISPLAY_NAME ?? username,
        role: "admin",
        passwordHash: await hashPassword(password),
        createdAt: new Date(),
      });
    }
    const admin = (await this.store.list()).find((a) => a.role === "admin");
    if (admin) await this.sessions.claimUnowned(admin.id);
  }

  async login(username: string, password: string, ctx: LoginContext = {}): Promise<AccountSession> {
    const found = await this.store.findByUsername(username);
    const ok = !!found && !found.disabledAt && (await verifyPassword(password, found.passwordHash));
    await this.store.recordLogin({
      id: randomUUID(),
      accountId: found?.id ?? null,
      username,
      ok,
      ip: ctx.ip ?? "",
      device: ctx.device ?? "",
      at: new Date(),
    });
    if (!found || !ok) throw new AccountAuthError(found?.disabledAt ? "disabled" : "bad-credentials");
    const { passwordHash: _drop, ...account } = found;
    return this.issueSession(account, ctx);
  }

  /** Mint an rcwa_ session token for an already-authenticated account (shared by the
   *  password path and OAuth). Records a successful login-audit entry. */
  async issueSession(account: Account, ctx: LoginContext = {}): Promise<AccountSession> {
    const token = "rcwa_" + randomBytes(24).toString("hex");
    await this.store.addToken({
      tokenHash: sha256(token),
      accountId: account.id,
      label: [ctx.method, ctx.device].filter(Boolean).join(" · ").slice(0, 120),
      createdAt: new Date(),
    });
    // OAuth path hasn't recorded an audit entry yet (password path already did).
    if (ctx.method && ctx.method !== "password") {
      await this.store.recordLogin({
        id: randomUUID(), accountId: account.id, username: account.username, ok: true,
        ip: ctx.ip ?? "", device: [ctx.method, ctx.device].filter(Boolean).join(" · "), at: new Date(),
      });
    }
    return { token, account };
  }

  /** Idle window: a token with no request for this long expires (default 30 min).
   *  While the app is open and focused it polls constantly, so an active session
   *  never idles out — only time genuinely away from the app counts. */
  static idleMs(): number {
    const min = Number(process.env.ACCOUNT_IDLE_MINUTES);
    return (Number.isFinite(min) && min > 0 ? min : 30) * 60_000;
  }

  /** Resolve a bearer to its account (null = unknown / revoked / disabled / idled out).
   *  Accepts interactive session tokens (rcwa_) and long-lived host tokens (rcwh_). */
  async verify(token: string): Promise<Account | null> {
    if (!token.startsWith("rcwa_") && !token.startsWith("rcwh_")) return null;
    return this.store.findByTokenHash(sha256(token), new Date(), AccountsService.idleMs());
  }

  async logout(token: string): Promise<void> {
    await this.store.revokeToken(sha256(token), new Date());
  }

  /** Quick-unlock PIN (scrypt-hashed). The account/session is the real credential;
   *  the PIN just gates the local lock screen on restart / away. */
  async setPin(accountId: string, pin: string): Promise<void> {
    await this.store.setPin(accountId, await hashPassword(pin));
  }
  async verifyPin(accountId: string, pin: string): Promise<boolean> {
    const hash = await this.store.getPinHash(accountId);
    return !!hash && verifyPassword(pin, hash);
  }
  async hasPin(accountId: string): Promise<boolean> {
    return !!(await this.store.getPinHash(accountId));
  }

  /** Mint a long-lived HOST token for an account — used by a provisioned redstone
   *  agent to authenticate without the interactive 30-min idle expiry. */
  async mintHostToken(accountId: string, label: string): Promise<string> {
    const token = "rcwh_" + randomBytes(24).toString("hex");
    await this.store.addToken({ tokenHash: sha256(token), accountId, label: label.slice(0, 120), createdAt: new Date(), kind: "host" });
    return token;
  }

  async create(input: NewAccount): Promise<Account> {
    return this.store.create({
      id: randomUUID(),
      username: input.username.toLowerCase(),
      displayName: input.displayName ?? input.username,
      role: input.role,
      passwordHash: await hashPassword(input.password),
      createdAt: new Date(),
      photo: input.photo ?? null,
      level: input.level ?? "",
      division: input.division ?? "",
      email: input.email ?? "",
      jira: input.jira ?? "",
      mattermost: input.mattermost ?? "",
      phone: input.phone ?? "",
      github: input.github ?? "",
      bio: input.bio ?? "",
    });
  }

  async updateProfile(id: string, patch: AccountProfilePatch): Promise<Account | null> {
    return this.store.updateProfile(id, patch);
  }

  async list(): Promise<Account[]> {
    return this.store.list();
  }

  async setDisabled(id: string, disabled: boolean): Promise<boolean> {
    const okay = await this.store.setDisabled(id, disabled ? new Date() : null);
    if (okay && disabled) await this.store.revokeAllTokens(id, new Date());
    return okay;
  }

  /** Hard-delete an agent (sessions are orphaned, not deleted). */
  async remove(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  async jiraNotifications(accountId: string, opts?: { unseenOnly?: boolean; limit?: number }) {
    return this.store.listJiraNotifications(accountId, opts);
  }
  async markJiraNotificationsSeen(accountId: string): Promise<void> {
    await this.store.markJiraNotificationsSeen(accountId, new Date());
  }

  async loginAudit(opts?: { accountId?: string; limit?: number }): Promise<LoginAuditEntry[]> {
    return this.store.listLoginAudit(opts);
  }

  /** Per-agent analytics for the admin console: session counts + token spend + est.
   *  cost, rolled up from every session (incl. closed) grouped by owner account. */
  async analytics(): Promise<AccountAnalytics[]> {
    const [accounts, sessions] = await Promise.all([this.store.list(), this.sessions.listAllIncludingClosed()]);
    const byId = new Map<string, AccountAnalytics>();
    for (const a of accounts) {
      byId.set(a.id, {
        accountId: a.id, username: a.username, displayName: a.displayName, role: a.role,
        photo: a.photo, level: a.level, division: a.division,
        sessions: 0, activeSessions: 0, tokensInput: 0, tokensOutput: 0, estCostUsd: 0,
        timeSpentMs: 0, lastActiveAt: null,
      });
    }
    for (const s of sessions) {
      const row = s.accountId ? byId.get(s.accountId) : undefined;
      if (!row) continue;
      row.sessions++;
      if (!s.closedAt) row.activeSessions++;
      row.tokensInput += s.tokensInput ?? 0;
      row.tokensOutput += s.tokensOutput ?? 0;
      row.estCostUsd += estCost(s.model, s.tokensInput ?? 0, s.tokensOutput ?? 0);
      // Time on task: attach → last-seen span per session, summed. A persistent session
      // (tmux left running for days/weeks) would otherwise count its ENTIRE wall-clock
      // lifetime as work — one session was open 28 days — so cap each session's credit at
      // a generous single workday (8h). It's a rough proxy, not literal keystroke time.
      const span = (s.lastSeenAt?.getTime() ?? 0) - (s.attachedAt?.getTime() ?? 0);
      if (span > 0) row.timeSpentMs += Math.min(span, 8 * 3.6e6);
      const seen = s.lastSeenAt?.getTime() ?? 0;
      if (!row.lastActiveAt || seen > row.lastActiveAt.getTime()) row.lastActiveAt = s.lastSeenAt ?? row.lastActiveAt;
    }
    return [...byId.values()].sort((a, b) => b.estCostUsd - a.estCostUsd);
  }

  /** One agent's session history (id, folder, machine, tokens, cost, timestamps). */
  async sessionHistory(accountId: string): Promise<AccountSessionRow[]> {
    const sessions = await this.sessions.listAllIncludingClosed();
    return sessions
      .filter((s) => s.accountId === accountId)
      .map((s) => ({
        id: s.id, machine: s.machine, cwd: s.cwd, model: s.model,
        tokensInput: s.tokensInput ?? 0, tokensOutput: s.tokensOutput ?? 0,
        estCostUsd: estCost(s.model, s.tokensInput ?? 0, s.tokensOutput ?? 0),
        attachedAt: s.attachedAt, lastSeenAt: s.lastSeenAt, closed: !!s.closedAt,
      }))
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }
}

export type AccountAnalytics = {
  accountId: string; username: string; displayName: string; role: string;
  photo: string | null; level: string; division: string;
  sessions: number; activeSessions: number; tokensInput: number; tokensOutput: number;
  estCostUsd: number; timeSpentMs: number; lastActiveAt: Date | null;
};
export type AccountSessionRow = {
  id: string; machine: string; cwd: string; model: string | null;
  tokensInput: number; tokensOutput: number; estCostUsd: number;
  attachedAt: Date; lastSeenAt: Date; closed: boolean;
};

// Per-million-token USD rates by model family (Anthropic list prices).
function estCost(model: string | null, tin: number, tout: number): number {
  const m = (model ?? "").toLowerCase();
  const rate = m.includes("opus") ? { i: 15, o: 75 }
    : m.includes("haiku") ? { i: 0.8, o: 4 }
    : { i: 3, o: 15 }; // sonnet / default
  return (tin / 1e6) * rate.i + (tout / 1e6) * rate.o;
}
