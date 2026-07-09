import type { Pool } from "pg";
import { AgentSessionSchema, type AgentSession, type SessionStatePatch, type UserTodo } from "@rcw/shared";
import type { SessionStore } from "../../domain/sessions/session-store.port";

const ROW = `id, machine, cwd, git_branch AS "gitBranch", attached_at AS "attachedAt", last_seen_at AS "lastSeenAt",
             wrapper_id AS "wrapperId", permission_mode AS "permissionMode", auto_mode_enabled AS "autoModeEnabled",
             latest_answer AS "latestAnswer", summary, todos, user_todos AS "userTodos", tags, transcript, working,
             context_tokens AS "contextTokens", model, token_input AS "tokensInput", token_output AS "tokensOutput",
             token_series AS "tokenSeries", pinned, snoozed_until AS "snoozedUntil", closed_at AS "closedAt", jira`;

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async upsert(s: AgentSession): Promise<AgentSession> {
    const { rows } = await this.pool.query(
      `INSERT INTO sessions (id, machine, cwd, git_branch, attached_at, last_seen_at, wrapper_id, permission_mode, auto_mode_enabled,
         latest_answer, summary, todos, transcript, pinned, snoozed_until, jira)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16::jsonb)
       ON CONFLICT (id) DO UPDATE SET machine=$2, git_branch=$4, last_seen_at=$6, wrapper_id=$7,
         permission_mode = COALESCE($8, sessions.permission_mode),
         auto_mode_enabled = $9,
         closed_at = NULL
       RETURNING ${ROW}`,
      [s.id, s.machine, s.cwd, s.gitBranch, s.attachedAt, s.lastSeenAt, s.wrapperId ?? null,
       s.permissionMode ?? null, s.autoModeEnabled ?? false,
       s.latestAnswer ?? null, s.summary ?? null, JSON.stringify(s.todos ?? []), JSON.stringify(s.transcript ?? []), s.pinned ?? false, s.snoozedUntil ?? null,
       s.jira ? JSON.stringify(s.jira) : null]
    );
    return AgentSessionSchema.parse(rows[0]);
  }
  async touch(id: string, at: Date): Promise<boolean> {
    const r = await this.pool.query("UPDATE sessions SET last_seen_at=$2 WHERE id=$1", [id, at]);
    return (r.rowCount ?? 0) > 0;
  }
  async get(id: string): Promise<AgentSession | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM sessions WHERE id=$1`, [id]);
    return rows[0] ? AgentSessionSchema.parse(rows[0]) : null;
  }
  async list(): Promise<AgentSession[]> {
    // Closed sessions keep their history (retrievable by id) but drop out of lists.
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM sessions WHERE closed_at IS NULL ORDER BY last_seen_at DESC`);
    return rows.map((r) => AgentSessionSchema.parse(r));
  }
  async getByWrapper(wrapperId: string): Promise<AgentSession | null> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM sessions WHERE wrapper_id=$1 ORDER BY last_seen_at DESC LIMIT 1`,
      [wrapperId]
    );
    return rows[0] ? AgentSessionSchema.parse(rows[0]) : null;
  }
  async setPermissionMode(id: string, mode: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET permission_mode=$2 WHERE id=$1`, [id, mode]);
  }
  async patchState(id: string, patch: SessionStatePatch): Promise<AgentSession | null> {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    if (patch.latestAnswer !== undefined) { vals.push(patch.latestAnswer); sets.push(`latest_answer = $${vals.length}`); }
    if (patch.summary !== undefined) { vals.push(patch.summary); sets.push(`summary = $${vals.length}`); }
    if (patch.todos !== undefined) { vals.push(JSON.stringify(patch.todos)); sets.push(`todos = $${vals.length}::jsonb`); }
    if (patch.transcript !== undefined) { vals.push(JSON.stringify(patch.transcript)); sets.push(`transcript = $${vals.length}::jsonb`); }
    if (patch.working !== undefined) { vals.push(patch.working); sets.push(`working = $${vals.length}`); }
    if (patch.contextTokens !== undefined) { vals.push(patch.contextTokens); sets.push(`context_tokens = $${vals.length}`); }
    if (patch.model !== undefined) { vals.push(patch.model); sets.push(`model = $${vals.length}`); }
    if (patch.tokensInput !== undefined) { vals.push(patch.tokensInput); sets.push(`token_input = $${vals.length}`); }
    if (patch.tokensOutput !== undefined) { vals.push(patch.tokensOutput); sets.push(`token_output = $${vals.length}`); }
    if (patch.tokenSeries !== undefined) { vals.push(JSON.stringify(patch.tokenSeries)); sets.push(`token_series = $${vals.length}::jsonb`); }
    if (patch.jira !== undefined) { vals.push(patch.jira ? JSON.stringify(patch.jira) : null); sets.push(`jira = $${vals.length}::jsonb`); }
    if (sets.length === 0) return this.get(id);
    const res = await this.pool.query(`UPDATE sessions SET ${sets.join(", ")} WHERE id = $1 RETURNING ${ROW}`, vals);
    return res.rows[0] ? AgentSessionSchema.parse(res.rows[0]) : null;
  }
  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.pool.query(`UPDATE sessions SET pinned = $2 WHERE id = $1`, [id, pinned]);
  }
  async setSnoozedUntil(id: string, until: Date | null): Promise<void> {
    await this.pool.query(`UPDATE sessions SET snoozed_until = $2 WHERE id = $1`, [id, until]);
  }
  async setUserTodos(id: string, todos: UserTodo[]): Promise<AgentSession | null> {
    const res = await this.pool.query(
      `UPDATE sessions SET user_todos = $2::jsonb WHERE id = $1 RETURNING ${ROW}`,
      [id, JSON.stringify(todos)]
    );
    return res.rows[0] ? AgentSessionSchema.parse(res.rows[0]) : null;
  }
  async setTags(id: string, tags: string[]): Promise<AgentSession | null> {
    const res = await this.pool.query(
      `UPDATE sessions SET tags = $2::jsonb WHERE id = $1 RETURNING ${ROW}`,
      [id, JSON.stringify(tags)]
    );
    return res.rows[0] ? AgentSessionSchema.parse(res.rows[0]) : null;
  }
  async close(id: string, at: Date): Promise<void> {
    // Idempotent — only stamps the first close, so a re-reap keeps the original time.
    await this.pool.query(`UPDATE sessions SET closed_at = $2 WHERE id = $1 AND closed_at IS NULL`, [id, at]);
  }
}
