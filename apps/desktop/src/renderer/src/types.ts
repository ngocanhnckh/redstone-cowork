export type Todo = { text: string; status: "pending" | "in_progress" | "completed" };
export type TranscriptMessage = { role: "user" | "assistant"; text: string };
export type SessionView = {
  id: string; machine: string; cwd: string; gitBranch: string | null;
  status: "active" | "waiting" | "stale" | "lost";
  pendingDecisions: number; waitingSince: string | null;
  latestAnswer: string | null; summary: string | null; todos: Todo[];
  transcript: TranscriptMessage[];
  pinned: boolean; snoozedUntil: string | null;
  lastSeenAt: string | null; attachedAt: string | null;
};
export type DecisionOption = { label: string; description?: string };
export type Decision = {
  id: string; sessionId: string;
  kind: "permission" | "question" | "completion" | "notification" | "instruction" | "mode";
  title: string; body: Record<string, unknown>; options: DecisionOption[];
};
