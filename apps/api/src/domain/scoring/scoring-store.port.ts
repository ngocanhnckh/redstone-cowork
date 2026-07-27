import type { ScoringProjectConfig, ScoringPenaltyType, ScoringTargets } from "@rcw/shared";

export type CompletionRecord = {
  issueKey: string;
  projectKey: string;
  accountId: string | null;
  jiraUser: string;
  estimateHours: number;
  completeStatus: string;
  completedAt: Date;
  weekKey: string;
  detectedAt: Date;
};

export type PenaltyRecord = {
  id: string;
  projectKey: string;
  issueKey: string;
  accountId: string | null;
  jiraUser: string;
  type: ScoringPenaltyType;
  taskEstimateHours: number;
  penaltyPct: number;
  points: number;
  detail: string;
  occurredAt: Date;
  weekKey: string;
  dedupeKey: string;
  voided: boolean;
  voidedBy: string | null;
  voidedAt: Date | null;
  detectedAt: Date;
};

export type CriticalRecord = {
  projectKey: string;
  weekKey: string;
  issueKey: string;
  summary: string;
  addedBy: string | null;
  addedAt: Date;
};

export interface ScoringStore {
  // ---- config ----
  getConfig(projectKey: string): Promise<ScoringProjectConfig | null>;
  listConfigs(): Promise<ScoringProjectConfig[]>;
  upsertConfig(cfg: ScoringProjectConfig, updatedBy: string | null): Promise<ScoringProjectConfig>;

  // ---- completions ----
  /** Insert unless the issue already has a completion (PK issue_key). Returns true if inserted. */
  insertCompletionIfAbsent(rec: CompletionRecord): Promise<boolean>;
  completionsForWeek(projectKey: string, weekKey: string): Promise<CompletionRecord[]>;
  completionsForAccount(accountId: string, projectKey: string): Promise<CompletionRecord[]>;

  // ---- penalties ----
  /** Insert unless dedupe_key already present. Returns true if inserted. */
  insertPenaltyIfAbsent(rec: PenaltyRecord): Promise<boolean>;
  penaltiesForWeek(projectKey: string, weekKey: string, opts?: { includeVoided?: boolean }): Promise<PenaltyRecord[]>;
  listPenalties(projectKey: string, opts?: { includeVoided?: boolean }): Promise<PenaltyRecord[]>;
  penaltiesForAccount(accountId: string, projectKey: string, opts?: { includeVoided?: boolean }): Promise<PenaltyRecord[]>;
  voidPenalty(id: string, voidedBy: string, at: Date): Promise<PenaltyRecord | null>;

  // ---- scan cursor ----
  getCursor(projectKey: string): Promise<Date | null>;
  setCursor(projectKey: string, lastUpdated: Date): Promise<void>;

  // ---- targets ----
  getTargets(projectKey: string, weekKey: string): Promise<ScoringTargets | null>;
  upsertTargets(t: ScoringTargets): Promise<ScoringTargets>;

  // ---- critical tasks ----
  getCritical(projectKey: string, weekKey: string): Promise<CriticalRecord[]>;
  /** Replace the whole critical set for a project-week. */
  setCritical(projectKey: string, weekKey: string, items: Array<{ issueKey: string; summary: string }>, addedBy: string | null): Promise<void>;
}

export const SCORING_STORE = Symbol("ScoringStore");
