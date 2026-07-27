import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ScoringProjectConfigSchema, type ScoringProjectConfig, type ScoringTargets } from "@rcw/shared";
import type {
  ScoringStore, CompletionRecord, PenaltyRecord, CriticalRecord,
} from "../../domain/scoring/scoring-store.port";

// pg returns `numeric` as strings and `timestamptz` as Date — coerce at the boundary.
const num = (v: unknown): number => (v == null ? 0 : Number(v));

type ConfigRow = {
  project_key: string; complete_statuses: string[]; reopen_penalty_pct: number; followup_penalty_pct: number;
  week_timezone: string; default_team_target: string; default_individual_target: string; enabled: boolean;
};
function toConfig(r: ConfigRow): ScoringProjectConfig {
  return ScoringProjectConfigSchema.parse({
    projectKey: r.project_key,
    completeStatuses: r.complete_statuses ?? [],
    reopenPenaltyPct: r.reopen_penalty_pct,
    followupPenaltyPct: r.followup_penalty_pct,
    weekTimezone: r.week_timezone,
    defaultTeamTarget: num(r.default_team_target),
    defaultIndividualTarget: num(r.default_individual_target),
    enabled: r.enabled,
  });
}

type CompletionRow = {
  issue_key: string; project_key: string; account_id: string | null; jira_user: string;
  estimate_hours: string; complete_status: string; completed_at: Date; week_key: string; detected_at: Date;
};
const toCompletion = (r: CompletionRow): CompletionRecord => ({
  issueKey: r.issue_key, projectKey: r.project_key, accountId: r.account_id, jiraUser: r.jira_user,
  estimateHours: num(r.estimate_hours), completeStatus: r.complete_status,
  completedAt: r.completed_at, weekKey: r.week_key, detectedAt: r.detected_at,
});

type PenaltyRow = {
  id: string; project_key: string; issue_key: string; account_id: string | null; jira_user: string;
  type: "reopen" | "followup"; task_estimate_hours: string; penalty_pct: number; points: string; detail: string;
  occurred_at: Date; week_key: string; dedupe_key: string; voided: boolean; voided_by: string | null;
  voided_at: Date | null; detected_at: Date;
};
const toPenalty = (r: PenaltyRow): PenaltyRecord => ({
  id: r.id, projectKey: r.project_key, issueKey: r.issue_key, accountId: r.account_id, jiraUser: r.jira_user,
  type: r.type, taskEstimateHours: num(r.task_estimate_hours), penaltyPct: r.penalty_pct, points: num(r.points),
  detail: r.detail, occurredAt: r.occurred_at, weekKey: r.week_key, dedupeKey: r.dedupe_key,
  voided: r.voided, voidedBy: r.voided_by, voidedAt: r.voided_at, detectedAt: r.detected_at,
});

export class PostgresScoringStore implements ScoringStore {
  constructor(private readonly pool: Pool) {}

  async getConfig(projectKey: string): Promise<ScoringProjectConfig | null> {
    const { rows } = await this.pool.query<ConfigRow>(`SELECT * FROM scoring_project_config WHERE project_key=$1`, [projectKey]);
    return rows[0] ? toConfig(rows[0]) : null;
  }
  async listConfigs(): Promise<ScoringProjectConfig[]> {
    const { rows } = await this.pool.query<ConfigRow>(`SELECT * FROM scoring_project_config ORDER BY project_key`);
    return rows.map(toConfig);
  }
  async upsertConfig(cfg: ScoringProjectConfig, updatedBy: string | null): Promise<ScoringProjectConfig> {
    const c = ScoringProjectConfigSchema.parse(cfg);
    const { rows } = await this.pool.query<ConfigRow>(
      `INSERT INTO scoring_project_config
         (project_key, complete_statuses, reopen_penalty_pct, followup_penalty_pct, week_timezone,
          default_team_target, default_individual_target, enabled, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)
       ON CONFLICT (project_key) DO UPDATE SET
         complete_statuses=$2, reopen_penalty_pct=$3, followup_penalty_pct=$4, week_timezone=$5,
         default_team_target=$6, default_individual_target=$7, enabled=$8, updated_at=now(), updated_by=$9
       RETURNING *`,
      [c.projectKey, c.completeStatuses, c.reopenPenaltyPct, c.followupPenaltyPct, c.weekTimezone,
       c.defaultTeamTarget, c.defaultIndividualTarget, c.enabled, updatedBy]
    );
    return toConfig(rows[0]);
  }

  async insertCompletionIfAbsent(rec: CompletionRecord): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO scoring_completions
         (issue_key, project_key, account_id, jira_user, estimate_hours, complete_status, completed_at, week_key, detected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (issue_key) DO NOTHING`,
      [rec.issueKey, rec.projectKey, rec.accountId, rec.jiraUser, rec.estimateHours, rec.completeStatus, rec.completedAt, rec.weekKey, rec.detectedAt]
    );
    return (r.rowCount ?? 0) > 0;
  }
  async completionsForWeek(projectKey: string, weekKey: string): Promise<CompletionRecord[]> {
    const { rows } = await this.pool.query<CompletionRow>(
      `SELECT * FROM scoring_completions WHERE project_key=$1 AND week_key=$2`, [projectKey, weekKey]);
    return rows.map(toCompletion);
  }
  async completionsForAccount(accountId: string, projectKey: string): Promise<CompletionRecord[]> {
    const { rows } = await this.pool.query<CompletionRow>(
      `SELECT * FROM scoring_completions WHERE account_id=$1 AND project_key=$2`, [accountId, projectKey]);
    return rows.map(toCompletion);
  }

  async insertPenaltyIfAbsent(rec: PenaltyRecord): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO scoring_penalties
         (id, project_key, issue_key, account_id, jira_user, type, task_estimate_hours, penalty_pct, points,
          detail, occurred_at, week_key, dedupe_key, voided, voided_by, voided_at, detected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [rec.id, rec.projectKey, rec.issueKey, rec.accountId, rec.jiraUser, rec.type, rec.taskEstimateHours,
       rec.penaltyPct, rec.points, rec.detail, rec.occurredAt, rec.weekKey, rec.dedupeKey,
       rec.voided, rec.voidedBy, rec.voidedAt, rec.detectedAt]
    );
    return (r.rowCount ?? 0) > 0;
  }
  async penaltiesForWeek(projectKey: string, weekKey: string, opts?: { includeVoided?: boolean }): Promise<PenaltyRecord[]> {
    const { rows } = await this.pool.query<PenaltyRow>(
      `SELECT * FROM scoring_penalties WHERE project_key=$1 AND week_key=$2 ${opts?.includeVoided ? "" : "AND voided=false"}`,
      [projectKey, weekKey]);
    return rows.map(toPenalty);
  }
  async listPenalties(projectKey: string, opts?: { includeVoided?: boolean }): Promise<PenaltyRecord[]> {
    const { rows } = await this.pool.query<PenaltyRow>(
      `SELECT * FROM scoring_penalties WHERE project_key=$1 ${opts?.includeVoided ? "" : "AND voided=false"} ORDER BY occurred_at DESC`,
      [projectKey]);
    return rows.map(toPenalty);
  }
  async penaltiesForAccount(accountId: string, projectKey: string, opts?: { includeVoided?: boolean }): Promise<PenaltyRecord[]> {
    const { rows } = await this.pool.query<PenaltyRow>(
      `SELECT * FROM scoring_penalties WHERE account_id=$1 AND project_key=$2 ${opts?.includeVoided ? "" : "AND voided=false"}`,
      [accountId, projectKey]);
    return rows.map(toPenalty);
  }
  async voidPenalty(id: string, voidedBy: string, at: Date): Promise<PenaltyRecord | null> {
    const { rows } = await this.pool.query<PenaltyRow>(
      `UPDATE scoring_penalties SET voided=true, voided_by=$2, voided_at=$3 WHERE id=$1 RETURNING *`, [id, voidedBy, at]);
    return rows[0] ? toPenalty(rows[0]) : null;
  }

  async getCursor(projectKey: string): Promise<Date | null> {
    const { rows } = await this.pool.query<{ last_updated: Date | null }>(
      `SELECT last_updated FROM scoring_scan_cursor WHERE project_key=$1`, [projectKey]);
    return rows[0]?.last_updated ?? null;
  }
  async setCursor(projectKey: string, lastUpdated: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO scoring_scan_cursor (project_key, last_updated, last_run_at) VALUES ($1,$2,now())
       ON CONFLICT (project_key) DO UPDATE SET last_updated=$2, last_run_at=now()`,
      [projectKey, lastUpdated]);
  }

  async getTargets(projectKey: string, weekKey: string): Promise<ScoringTargets | null> {
    const { rows } = await this.pool.query<{ project_key: string; week_key: string; team_target: string; individual_target: string }>(
      `SELECT * FROM scoring_targets WHERE project_key=$1 AND week_key=$2`, [projectKey, weekKey]);
    const r = rows[0];
    return r ? { projectKey: r.project_key, weekKey: r.week_key, teamTarget: num(r.team_target), individualTarget: num(r.individual_target) } : null;
  }
  async upsertTargets(t: ScoringTargets): Promise<ScoringTargets> {
    await this.pool.query(
      `INSERT INTO scoring_targets (project_key, week_key, team_target, individual_target) VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_key, week_key) DO UPDATE SET team_target=$3, individual_target=$4`,
      [t.projectKey, t.weekKey, t.teamTarget, t.individualTarget]);
    return t;
  }

  async getCritical(projectKey: string, weekKey: string): Promise<CriticalRecord[]> {
    const { rows } = await this.pool.query<{ project_key: string; week_key: string; issue_key: string; summary: string; added_by: string | null; added_at: Date }>(
      `SELECT * FROM scoring_critical WHERE project_key=$1 AND week_key=$2 ORDER BY issue_key`, [projectKey, weekKey]);
    return rows.map((r) => ({ projectKey: r.project_key, weekKey: r.week_key, issueKey: r.issue_key, summary: r.summary, addedBy: r.added_by, addedAt: r.added_at }));
  }
  async setCritical(projectKey: string, weekKey: string, items: Array<{ issueKey: string; summary: string }>, addedBy: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM scoring_critical WHERE project_key=$1 AND week_key=$2`, [projectKey, weekKey]);
      for (const i of items) {
        await client.query(
          `INSERT INTO scoring_critical (project_key, week_key, issue_key, summary, added_by, added_at)
           VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (project_key, week_key, issue_key) DO UPDATE SET summary=$4`,
          [projectKey, weekKey, i.issueKey, i.summary, addedBy]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
