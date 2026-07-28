import type { ServerHost } from "../workspace";

// ---------------------------------------------------------------------------
// The session-runtime seam.
//
// Everything the cockpit needs *from a backend* to show and drive Claude sessions.
// Two implementations:
//
//   cloud-provider.ts   → today's cowork server (apps/api) via main/api.ts
//   direct-provider.ts  → a direct SSH connection to each host, no server at all
//
// Deliberately NARROW. Team features (accounts, scoring, agency, jira, servers,
// bug reports) are NOT here — they always talk to the cowork server in both
// editions, so routing them through this interface would buy nothing and would
// force the direct provider to stub two dozen methods it has no opinion about.
//
// `ProviderEvent` keeps the exact `{type, payload}` shape of `api.startStream`,
// including the `poll.tick` type, so `index.ts`'s broadcast loop and the
// renderer's `onUpdate` → `refresh()` path work unchanged against either backend.
// ---------------------------------------------------------------------------

export type ProviderEvent = { type: string; payload: unknown };

export type Resolution = {
  choice?: string | null;
  answers?: Record<string, string | string[]> | null;
  custom?: string | null;
};

export type ProviderMode = "cloud" | "direct" | "composite";

export interface SessionProvider {
  readonly mode: ProviderMode;

  /**
   * Begin producing events. Returns a stop function. `shouldPoll` lets the caller
   * gate background work when no window is visible (same contract as
   * `api.startStream`, which uses it to idle when the app is backgrounded).
   */
  start(onEvent: (e: ProviderEvent) => void, shouldPoll?: () => boolean): () => void;

  // --- reads -------------------------------------------------------------
  getSessions(): Promise<unknown[]>;
  getQueue(): Promise<unknown[]>;
  getPendingDecisions(): Promise<unknown[]>;
  getInventory(): Promise<unknown>;
  getTelemetry(): Promise<unknown[]>;
  getDocker(): Promise<unknown[]>;
  getCaps(): Promise<unknown[]>;
  /** Reachable SSH targets, fed to `workspace.setServerHosts()`. */
  getHosts(): Promise<ServerHost[]>;

  // --- writes ------------------------------------------------------------
  instruct(sessionId: string, text: string): Promise<unknown>;
  interrupt(sessionId: string, text?: string): Promise<unknown>;
  resolveDecision(id: string, resolution: Resolution): Promise<unknown>;
  switchMode(sessionId: string, mode: string): Promise<unknown>;
  snooze(id: string, minutes: number): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  dismissSession(id: string): Promise<void>;
  addTag(sessionId: string, tag: string): Promise<unknown>;
  removeTag(sessionId: string, tag: string): Promise<unknown>;
  addUserTodo(sessionId: string, text: string): Promise<unknown>;
  toggleUserTodo(sessionId: string, todoId: string): Promise<unknown>;
  deleteUserTodo(sessionId: string, todoId: string): Promise<unknown>;
}
