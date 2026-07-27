import { z } from "zod";

/** Per-project scoring configuration (admin-managed). An empty `completeStatuses` means
 *  "fall back to any Done-category status" until an admin pins the set for the project. */
export const ScoringProjectConfigSchema = z.object({
  projectKey: z.string().min(1),
  /** Jira status NAMES that count as "complete" (earns the estimate hours). */
  completeStatuses: z.array(z.string()).default([]),
  reopenPenaltyPct: z.number().int().min(0).max(100).default(30),
  followupPenaltyPct: z.number().int().min(0).max(100).default(30),
  /** IANA zone the Mon–Sun week boundary is computed in. */
  weekTimezone: z.string().default("Asia/Ho_Chi_Minh"),
  defaultTeamTarget: z.number().min(0).default(0),
  defaultIndividualTarget: z.number().min(0).default(0),
  /** The scanner only scans enabled projects. */
  enabled: z.boolean().default(true),
});
export type ScoringProjectConfig = z.infer<typeof ScoringProjectConfigSchema>;

/** Admin patch for a project config — every field optional so the UI can PATCH-partial. */
export const ScoringProjectConfigPatchSchema = z.object({
  completeStatuses: z.array(z.string().max(120)).max(40).optional(),
  reopenPenaltyPct: z.number().int().min(0).max(100).optional(),
  followupPenaltyPct: z.number().int().min(0).max(100).optional(),
  weekTimezone: z.string().max(64).optional(),
  defaultTeamTarget: z.number().min(0).optional(),
  defaultIndividualTarget: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
});
export type ScoringProjectConfigPatch = z.infer<typeof ScoringProjectConfigPatchSchema>;

export const ScoringPenaltyTypeSchema = z.enum(["reopen", "followup"]);
export type ScoringPenaltyType = z.infer<typeof ScoringPenaltyTypeSchema>;

/** One deduction on the voidable ledger. `points` is negative. */
export const ScoringPenaltySchema = z.object({
  id: z.string().min(1),
  projectKey: z.string(),
  issueKey: z.string(),
  accountId: z.string().nullable(),
  jiraUser: z.string().default(""),
  type: ScoringPenaltyTypeSchema,
  taskEstimateHours: z.number(),
  penaltyPct: z.number(),
  points: z.number(),
  detail: z.string().default(""),
  occurredAt: z.coerce.date(),
  weekKey: z.string(),
  voided: z.boolean().default(false),
  voidedBy: z.string().nullable().default(null),
  voidedAt: z.coerce.date().nullable().default(null),
  detectedAt: z.coerce.date(),
});
export type ScoringPenalty = z.infer<typeof ScoringPenaltySchema>;

export const ScoringTargetsSchema = z.object({
  projectKey: z.string().min(1),
  weekKey: z.string().min(1),
  teamTarget: z.number().min(0).default(0),
  individualTarget: z.number().min(0).default(0),
});
export type ScoringTargets = z.infer<typeof ScoringTargetsSchema>;

// ---- Read models (server-computed; not persisted as-is) --------------------

/** A single critical (committed) issue for a project-week + whether it's currently done. */
export type CriticalItem = {
  issueKey: string;
  summary: string;
  status: string;
  statusCategory: string;
  done: boolean;
};
export type CriticalProgress = {
  done: number;
  total: number;
  items: CriticalItem[];
};

/** One agent's row on a project leaderboard. `score = completedHours − penaltyHours`. */
export type ScoringLeaderEntry = {
  accountId: string | null;
  jiraUser: string;
  displayName: string;
  photo: string | null;
  completedHours: number;
  penaltyHours: number;
  score: number;
  completions: number;
  penalties: number;
  rank: number;
};

export type ScoringBoard = {
  projectKey: string;
  weekKey: string;
  window: { start: string; end: string };
  timezone: string;
  teamScore: number;
  teamTarget: number;
  individualTarget: number;
  entries: ScoringLeaderEntry[];
  critical: CriticalProgress;
};

/** The logged-in agent's own standing on their project team — the right-rail widget source. */
export type MyScore = {
  projectKey: string;
  weekKey: string;
  myScore: number;
  completedHours: number;
  penaltyHours: number;
  individualTarget: number;
  rank: number;
  teamMembers: number;
  teamScore: number;
  teamTarget: number;
  critical: CriticalProgress;
};

/** One past week on an agent's score trend (derived from the week-keyed ledgers). */
export type ScoreHistoryPoint = {
  weekKey: string;
  completedHours: number;
  penaltyHours: number;
  score: number;
};
/** An agent's score over the last N weeks for a project — the "my history" view. */
export type ScoreHistory = {
  projectKey: string;
  points: ScoreHistoryPoint[];
};

// ---- Agent of the Week (award) ---------------------------------------------
// Distinct from the per-project effort board: a roster-wide weekly award that blends the
// agent's effort score with a portion of their token spend, each normalised against the
// roster's best, so a big spender who ships nothing can't win and a shipper is rewarded.

export const AGENT_WEEK_WEIGHTS = { effort: 0.75, tokens: 0.25 } as const;

export type AgentWeekEntry = {
  accountId: string;
  displayName: string;
  username: string;
  photo: string | null;
  division: string;
  jira: string;
  /** Effort score = Σ completed estimate-hours − Σ penalties across the agent's projects this week. */
  effortScore: number;
  tokens: number;
  /** 0–100 blended ranking value. */
  score: number;
  rank: number;
};
export type AgentWeekAward = {
  prize: string;
  window: { start: string; end: string };
  weights: { effort: number; tokens: number };
  entries: AgentWeekEntry[];
};
