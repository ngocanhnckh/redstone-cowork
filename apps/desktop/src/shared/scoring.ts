// Renderer-side mirrors of the API scoring read models (@rcw/shared/scoring). Kept as plain
// types (no zod) to match the rest of apps/desktop/src/shared.

export type ScoringProjectConfig = {
  projectKey: string;
  completeStatuses: string[];
  reopenPenaltyPct: number;
  followupPenaltyPct: number;
  weekTimezone: string;
  defaultTeamTarget: number;
  defaultIndividualTarget: number;
  enabled: boolean;
};

export type CriticalItem = { issueKey: string; summary: string; status: string; statusCategory: string; done: boolean };
export type CriticalProgress = { done: number; total: number; items: CriticalItem[] };

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
} | null;

export type ScoreHistoryPoint = { weekKey: string; completedHours: number; penaltyHours: number; score: number };
export type ScoreHistory = { projectKey: string; points: ScoreHistoryPoint[] };

export type ScoringPenaltyView = {
  id: string;
  projectKey: string;
  issueKey: string;
  accountId: string | null;
  jiraUser: string;
  displayName: string;
  type: "reopen" | "followup";
  taskEstimateHours: number;
  penaltyPct: number;
  points: number;
  detail: string;
  occurredAt: string;
  weekKey: string;
  voided: boolean;
  voidedBy: string | null;
  voidedAt: string | null;
  detectedAt: string;
};

export type AgentWeekEntry = {
  accountId: string;
  displayName: string;
  username: string;
  photo: string | null;
  division: string;
  jira: string;
  effortScore: number;
  tokens: number;
  score: number;
  rank: number;
};
export type AgentWeekAward = {
  prize: string;
  window: { start: string; end: string };
  weights: { effort: number; tokens: number };
  entries: AgentWeekEntry[];
};

export type ScoringProjectRef = { projectKey: string; enabled: boolean };
export type SprintIssue = { key: string; summary: string; status: string; statusCategoryKey: string; assignee: string | null };
