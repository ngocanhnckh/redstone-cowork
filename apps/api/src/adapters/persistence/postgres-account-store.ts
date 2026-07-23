import type { Pool } from "pg";
import { AccountSchema, JiraNotificationSchema, LoginAuditEntrySchema, type Account, type AccountProfilePatch, type JiraNotification, type LoginAuditEntry } from "@rcw/shared";
import type { AccountStore, AccountTokenRecord, NewAccountRecord } from "../../domain/accounts/account-store.port";

const ROW = `id, username, display_name AS "displayName", role, photo, level, division, email, jira, mattermost, phone,
             created_at AS "createdAt", disabled_at AS "disabledAt"`;
const AUDIT_ROW = `id, account_id AS "accountId", username, ok, ip, device, at`;

export class PostgresAccountStore implements AccountStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: NewAccountRecord): Promise<Account> {
    const { rows } = await this.pool.query(
      `INSERT INTO accounts (id, username, display_name, role, password_hash, created_at,
                             photo, level, division, email, jira, mattermost, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${ROW}`,
      [rec.id, rec.username, rec.displayName, rec.role, rec.passwordHash, rec.createdAt,
       rec.photo ?? null, rec.level ?? "", rec.division ?? "", rec.email ?? "",
       rec.jira ?? "", rec.mattermost ?? "", rec.phone ?? ""]
    );
    return AccountSchema.parse(rows[0]);
  }

  async updateProfile(id: string, patch: AccountProfilePatch): Promise<Account | null> {
    // Column-mapped, undefined-skipping merge — only sent fields change.
    const cols: Record<string, string> = {
      displayName: "display_name", photo: "photo", level: "level", division: "division",
      email: "email", jira: "jira", mattermost: "mattermost", phone: "phone",
      role: "role",
    };
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [k, col] of Object.entries(cols)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v !== undefined) {
        vals.push(v);
        sets.push(`${col}=$${vals.length}`);
      }
    }
    if (!sets.length) return this.findById(id);
    const { rows } = await this.pool.query(
      `UPDATE accounts SET ${sets.join(", ")} WHERE id=$1 RETURNING ${ROW}`,
      vals
    );
    return rows[0] ? AccountSchema.parse(rows[0]) : null;
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

  async findByJiraUsername(jira: string): Promise<Account | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM accounts WHERE lower(jira)=lower($1) AND jira<>''`, [jira]);
    return rows[0] ? AccountSchema.parse(rows[0]) : null;
  }

  async setJiraCredentials(id: string, baseUrl: string, patEncrypted: string): Promise<void> {
    await this.pool.query(`UPDATE accounts SET jira_base_url=$2, jira_pat_enc=$3 WHERE id=$1`, [id, baseUrl, patEncrypted]);
  }

  async getJiraPatEncrypted(id: string): Promise<{ baseUrl: string; patEncrypted: string } | null> {
    const { rows } = await this.pool.query(`SELECT jira_base_url AS "baseUrl", jira_pat_enc AS "patEncrypted" FROM accounts WHERE id=$1`, [id]);
    return rows[0]?.patEncrypted ? { baseUrl: rows[0].baseUrl ?? "", patEncrypted: rows[0].patEncrypted } : null;
  }

  async addFaceDescriptor(accountId: string, descriptor: number[]): Promise<void> {
    await this.pool.query(
      `UPDATE accounts SET face_descriptors = face_descriptors || $2::jsonb WHERE id=$1`,
      [accountId, JSON.stringify([descriptor])]
    );
  }
  async getFaceDescriptors(accountId: string): Promise<number[][]> {
    const { rows } = await this.pool.query(`SELECT face_descriptors AS d FROM accounts WHERE id=$1`, [accountId]);
    return (rows[0]?.d as number[][]) ?? [];
  }
  async trustDevice(rec: { id: string; accountId: string; secretHash: string; label: string; createdAt: Date }): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_trust (id, account_id, secret_hash, label, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (secret_hash) DO NOTHING`,
      [rec.id, rec.accountId, rec.secretHash, rec.label, rec.createdAt]
    );
  }
  async findDeviceAccount(secretHash: string, now: Date): Promise<Account | null> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.username, a.display_name AS "displayName", a.role, a.photo, a.level, a.division,
              a.email, a.jira, a.mattermost, a.phone, a.webhook, a.created_at AS "createdAt", a.disabled_at AS "disabledAt"
       FROM device_trust t JOIN accounts a ON a.id = t.account_id
       WHERE t.secret_hash=$1 AND t.revoked_at IS NULL AND a.disabled_at IS NULL`,
      [secretHash]
    );
    if (!rows[0]) return null;
    await this.pool.query(`UPDATE device_trust SET last_used_at=$2 WHERE secret_hash=$1`, [secretHash, now]);
    return AccountSchema.parse(rows[0]);
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

  async addJiraNotification(n: JiraNotification): Promise<void> {
    await this.pool.query(
      `INSERT INTO jira_notifications (id, account_id, issue_key, summary, event, status, actor, url, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [n.id, n.accountId, n.issueKey, n.summary, n.event, n.status, n.actor, n.url, n.createdAt]
    );
  }
  async listJiraNotifications(accountId: string, opts?: { unseenOnly?: boolean; limit?: number }): Promise<JiraNotification[]> {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const { rows } = await this.pool.query(
      `SELECT id, account_id AS "accountId", issue_key AS "issueKey", summary, event, status, actor, url,
              created_at AS "createdAt", seen_at AS "seenAt"
       FROM jira_notifications WHERE account_id=$1 ${opts?.unseenOnly ? "AND seen_at IS NULL" : ""}
       ORDER BY created_at DESC LIMIT $2`,
      [accountId, limit]
    );
    return rows.map((r) => JiraNotificationSchema.parse(r));
  }
  async markJiraNotificationsSeen(accountId: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE jira_notifications SET seen_at=$2 WHERE account_id=$1 AND seen_at IS NULL`, [accountId, at]);
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
      `INSERT INTO account_tokens (token_hash, account_id, label, created_at, kind) VALUES ($1,$2,$3,$4,$5)`,
      [rec.tokenHash, rec.accountId, rec.label, rec.createdAt, rec.kind ?? "session"]
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
         AND (t.kind = 'host' OR COALESCE(t.last_used_at, t.created_at) > $2)`,
      [tokenHash, cutoff]
    );
    if (!rows[0]) {
      // Best-effort tombstone so an idled-out token can't be resurrected later.
      await this.pool.query(
        `UPDATE account_tokens SET revoked_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL
           AND kind <> 'host' AND COALESCE(last_used_at, created_at) <= $3`,
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
