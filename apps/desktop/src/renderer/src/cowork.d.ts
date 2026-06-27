export {};
declare global {
  interface Window {
    cowork: {
      // Config
      getConfig(): Promise<{ serverUrl: string; hasToken: boolean } | null>;
      saveConfig(serverUrl: string, token: string): Promise<{ ok: boolean }>;
      clearConfig(): Promise<void>;

      // Data
      getSessions(): Promise<unknown[]>;
      getQueue(): Promise<unknown[]>;
      getPendingDecisions(): Promise<unknown[]>;
      resolveDecision(
        id: string,
        resolution: {
          choice?: string | null;
          answers?: Record<string, string | string[]> | null;
          custom?: string | null;
        }
      ): Promise<unknown>;
      snooze(id: string, minutes: number): Promise<void>;
      pin(id: string, pinned: boolean): Promise<void>;
      instruct(sessionId: string, text: string): Promise<unknown>;
      switchMode(sessionId: string, mode: string): Promise<unknown>;

      // Workspace config
      getWorkspaceConfig(a: {
        sessionId: string;
        cwd: string;
        machine: string;
      }): Promise<{ sshHost: string; forwardPorts: number[]; browserUrl: string } | null>;
      saveWorkspaceConfig(a: {
        sessionId: string;
        cwd: string;
        machine: string;
        config: { sshHost: string; forwardPorts: number[]; browserUrl: string };
      }): Promise<{ ok: boolean; error?: string }>;

      // Stream
      onUpdate(cb: () => void): () => void;
    };
  }
}
