import type { Pool } from "pg";
import { AccountSchema, LoginAuditEntrySchema, type Account, type LoginAuditEntry } from "@rcw/shared";
import type { AccountStore, AccountTokenRecord, NewAccountRecord } from "../../domain/accounts/account-store.port";

const ROW = `id, username, display_name AS "displayName", role, created_at AS "createdAt", disabled_at AS "disabledAt"`;
const AUDIT_ROW = `id, account_id AS "accountId", username, ok, ip, device, at`;

export class PostgresAccountStore implements AccountStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: NewAccountRecord): Promise<Account> {
    const { rows } = await this.pool.query(
      `INSERT INTO accounts (id, username, display_name, role, password_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${ROW}`,
      [rec.id, rec.username, rec.displayName, rec.role, rec.passwordHash, rec.createdAt]
    );
    return AccountSchema.parse(rows[0]);
  }

  async findByUsername(username: string): Promise<(Account & { passwordHash: string }) | null> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW}, password_hash AS "passwordHash" FROM accounts WHERE username=$1`,
      [username]
    );
    if (!rows[0]) return null;
    const { passwordHash, ...rest } = rows[0];
    return { ...AccountSchema.parse(rest), passwordHash };
  }

  async findById(id: string): Promise<Account | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM accounts WHERE id=$1`, [id]);
    return rows[0] ? AccountSchema.parse(rows[0]) : null;
  }

  async list(): Promise<Account[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM accounts ORDER BY username`);
    return rows.map((r) => AccountSchema.parse(r));
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM accounts`);
    return rows[0].n as number;
  }

  async setDisabled(id: string, at: Date | null): Promise<boolean> {
    const r = await this.pool.query(`UPDATE accounts SET disabled_at=$2 WHERE id=$1`, [id, at]);
    return (r.rowCount ?? 0) > 0;
  }

  async setPassword(id: string, passwordHash: string): Promise<boolean> {
    const r = await this.pool.query(`UPDATE accounts SET password_hash=$2 WHERE id=$1`, [id, passwordHash]);
    return (r.rowCount ?? 0) > 0;
  }

  async recordLogin(entry: LoginAuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO login_audit (id, account_id, username, ok, ip, device, at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.id, entry.accountId, entry.username, entry.ok, entry.ip, entry.device, entry.at]
    );
  }

  async listLoginAudit(opts?: { accountId?: string; limit?: number }): Promise<LoginAuditEntry[]> {
    const limit = Math.min(opts?.limit ?? 200, 1000);
    const { rows } = opts?.accountId
      ? await this.pool.query(`SELECT ${AUDIT_ROW} FROM login_audit WHERE account_id=$1 ORDER BY at DESC LIMIT $2`, [
          opts.accountId,
          limit,
        ])
      : await this.pool.query(`SELECT ${AUDIT_ROW} FROM login_audit ORDER BY at DESC LIMIT $1`, [limit]);
    return rows.map((r) => LoginAuditEntrySchema.parse(r));
  }

  async addToken(rec: AccountTokenRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_tokens (token_hash, account_id, label, created_at) VALUES ($1,$2,$3,$4)`,
      [rec.tokenHash, rec.accountId, rec.label, rec.createdAt]
    );
  }

  async findByTokenHash(tokenHash: string, now: Date, maxIdleMs: number): Promise<Account | null> {
    // Idle expiry: a token unused for maxIdleMs is dead (the user walked away).
    const cutoff = new Date(now.getTime() - maxIdleMs);
    const { rows } = await this.pool.query(
      `SELECT a.id, a.username, a.display_name AS "displayName", a.role,
              a.created_at AS "createdAt", a.disabled_at AS "disabledAt"
       FROM account_tokens t JOIN accounts a ON a.id = t.account_id
       WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND a.disabled_at IS NULL
         AND COALESCE(t.last_used_at, t.created_at) > $2`,
      [tokenHash, cutoff]
    );
    if (!rows[0]) {
      // Best-effort tombstone so an idled-out token can't be resurrected later.
      await this.pool.query(
        `UPDATE account_tokens SET revoked_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL
           AND COALESCE(last_used_at, created_at) <= $3`,
        [tokenHash, now, cutoff]
      );
      return null;
    }
    await this.pool.query(`UPDATE account_tokens SET last_used_at=$2 WHERE token_hash=$1`, [tokenHash, now]);
    return AccountSchema.parse(rows[0]);
  }

  async revokeToken(tokenHash: string, at: Date): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE account_tokens SET revoked_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL`,
      [tokenHash, at]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async revokeAllTokens(accountId: string, at: Date): Promise<number> {
    const r = await this.pool.query(
      `UPDATE account_tokens SET revoked_at=$2 WHERE account_id=$1 AND revoked_at IS NULL`,
      [accountId, at]
    );
    return r.rowCount ?? 0;
  }
}
