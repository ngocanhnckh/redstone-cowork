import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Account, AccountSession, LoginAuditEntry, NewAccount } from "@rcw/shared";
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
export type LoginContext = { ip?: string; device?: string };

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
    const token = "rcwa_" + randomBytes(24).toString("hex");
    await this.store.addToken({
      tokenHash: sha256(token),
      accountId: found.id,
      label: ctx.device?.slice(0, 120) ?? "",
      createdAt: new Date(),
    });
    const { passwordHash: _drop, ...account } = found;
    return { token, account };
  }

  /** Resolve a bearer to its account (null = not an account token / revoked / disabled). */
  async verify(token: string): Promise<Account | null> {
    if (!token.startsWith("rcwa_")) return null;
    return this.store.findByTokenHash(sha256(token), new Date());
  }

  async logout(token: string): Promise<void> {
    await this.store.revokeToken(sha256(token), new Date());
  }

  async create(input: NewAccount): Promise<Account> {
    return this.store.create({
      id: randomUUID(),
      username: input.username.toLowerCase(),
      displayName: input.displayName ?? input.username,
      role: input.role,
      passwordHash: await hashPassword(input.password),
      createdAt: new Date(),
    });
  }

  async list(): Promise<Account[]> {
    return this.store.list();
  }

  async setDisabled(id: string, disabled: boolean): Promise<boolean> {
    const okay = await this.store.setDisabled(id, disabled ? new Date() : null);
    if (okay && disabled) await this.store.revokeAllTokens(id, new Date());
    return okay;
  }

  async loginAudit(opts?: { accountId?: string; limit?: number }): Promise<LoginAuditEntry[]> {
    return this.store.listLoginAudit(opts);
  }
}
