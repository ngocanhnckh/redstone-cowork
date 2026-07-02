export type Todo = { text: string; status: "pending" | "in_progress" | "completed" };
export type UserTodo = { id: string; text: string; done: boolean };
export type TranscriptMessage = { role: "user" | "assistant"; text: string };
export type SessionView = {
  id: string; machine: string; cwd: string; gitBranch: string | null;
  wrapperId: string | null;
  status: "active" | "waiting" | "stale" | "lost";
  pendingDecisions: number; waitingSince: string | null;
  latestAnswer: string | null; summary: string | null; todos: Todo[];
  userTodos: UserTodo[];
  tags: string[];
  transcript: TranscriptMessage[];
  working: boolean;
  pinned: boolean; snoozedUntil: string | null;
  lastSeenAt: string | null; attachedAt: string | null;
  permissionMode: string | null; autoModeEnabled: boolean;
};
export type Host = { id: string; machine: string; user: string | null; os: string | null; lastSeenAt: string };
export type DiscoveredSession = {
  id: string; hostId: string; machine: string; cwd: string; folder: string;
  title: string | null; lastActive: string; messageCount: number; sizeBytes: number;
  source: "cowork" | "external"; tags: string[];
};

export type HostGeo = { lat: number; long: number; city: string | null; country: string | null };
export type HostTelemetry = {
  cpuPct: number; ramUsed: number; ramTotal: number;
  netRxBps: number | null; netTxBps: number | null; uptimeSec: number; geo: HostGeo | null;
};
export type HostTelemetryView = {
  hostId: string; machine: string; at: string; latest: HostTelemetry;
  cpuHistory: number[]; netRxHistory: number[]; netTxHistory: number[];
};

export type DockerContainer = {
  id: string; name: string; image: string; state: string; status: string;
  ports: string | null; cpuPct: number | null; memUsed: number | null; memPct: number | null;
};
export type DockerHostView = { hostId: string; machine: string; at: string; available: boolean; containers: DockerContainer[] };

export type Commit = { hash: string; author: string; relative: string; date: string; subject: string };
export type GitInfo = { ok: boolean; repo: boolean; branch: string | null; ahead: number; behind: number; dirty: number; commits: Commit[]; error?: string };

export type DecisionOption = { label: string; description?: string };
export type Decision = {
  id: string; sessionId: string;
  kind: "permission" | "question" | "completion" | "notification" | "instruction" | "mode";
  title: string; body: Record<string, unknown>; options: DecisionOption[];
};
