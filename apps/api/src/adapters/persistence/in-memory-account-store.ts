import type { Account, LoginAuditEntry } from "@rcw/shared";
import type { AccountStore, AccountTokenRecord, NewAccountRecord } from "../../domain/accounts/account-store.port";

type Row = NewAccountRecord & { disabledAt: Date | null };
type TokenRow = AccountTokenRecord & { lastUsedAt: Date | null; revokedAt: Date | null };

const toAccount = (r: Row): Account => ({
  id: r.id,
  username: r.username,
  displayName: r.displayName,
  role: r.role,
  createdAt: r.createdAt,
  disabledAt: r.disabledAt,
});

export class InMemoryAccountStore implements AccountStore {
  private rows = new Map<string, Row>();
  private tokens = new Map<string, TokenRow>();

  async create(rec: NewAccountRecord): Promise<Account> {
    if ([...this.rows.values()].some((r) => r.username === rec.username)) {
      throw new Error("username already exists");
    }
    const row: Row = { ...rec, disabledAt: null };
    this.rows.set(rec.id, row);
    return toAccount(row);
  }

  async findByUsername(username: string): Promise<(Account & { passwordHash: string }) | null> {
    const row = [...this.rows.values()].find((r) => r.username === username);
    return row ? { ...toAccount(row), passwordHash: row.passwordHash } : null;
  }

  async findById(id: string): Promise<Account | null> {
    const row = this.rows.get(id);
    return row ? toAccount(row) : null;
  }

  async list(): Promise<Account[]> {
    return [...this.rows.values()].map(toAccount).sort((a, b) => a.username.localeCompare(b.username));
  }

  async count(): Promise<number> {
    return this.rows.size;
  }

  async setDisabled(id: string, at: Date | null): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    row.disabledAt = at;
    return true;
  }

  async setPassword(id: string, passwordHash: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    row.passwordHash = passwordHash;
    return true;
  }

  private audit: LoginAuditEntry[] = [];

  async recordLogin(entry: LoginAuditEntry): Promise<void> {
    this.audit.push(entry);
  }

  async listLoginAudit(opts?: { accountId?: string; limit?: number }): Promise<LoginAuditEntry[]> {
    const rows = this.audit
      .filter((e) => !opts?.accountId || e.accountId === opts.accountId)
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    return rows.slice(0, opts?.limit ?? 200);
  }

  async addToken(rec: AccountTokenRecord): Promise<void> {
    this.tokens.set(rec.tokenHash, { ...rec, lastUsedAt: null, revokedAt: null });
  }

  async findByTokenHash(tokenHash: string, now: Date, maxIdleMs: number): Promise<Account | null> {
    const t = this.tokens.get(tokenHash);
    if (!t || t.revokedAt) return null;
    // Idle expiry: a token unused for maxIdleMs is dead (the user walked away).
    const lastActive = t.lastUsedAt ?? t.createdAt;
    if (now.getTime() - lastActive.getTime() > maxIdleMs) {
      t.revokedAt = now;
      return null;
    }
    const row = this.rows.get(t.accountId);
    if (!row || row.disabledAt) return null;
    t.lastUsedAt = now;
    return toAccount(row);
  }

  async revokeToken(tokenHash: string, at: Date): Promise<boolean> {
    const t = this.tokens.get(tokenHash);
    if (!t || t.revokedAt) return false;
    t.revokedAt = at;
    return true;
  }

  async revokeAllTokens(accountId: string, at: Date): Promise<number> {
    let n = 0;
    for (const t of this.tokens.values()) {
      if (t.accountId === accountId && !t.revokedAt) {
        t.revokedAt = at;
        n++;
      }
    }
    return n;
  }
}
