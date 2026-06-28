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
      }): Promise<{ forwardPorts: number[]; browserUrl: string } | null>;
      saveWorkspaceConfig(a: {
        sessionId: string;
        cwd: string;
        machine: string;
        config: { forwardPorts: number[]; browserUrl: string };
      }): Promise<{ ok: boolean; error?: string }>;

      // Per-machine SSH host
      getSshHost(machine: string): Promise<string>;
      setSshHost(machine: string, host: string): Promise<{ ok: boolean; error?: string }>;
      isLocalMachine(machine: string): Promise<boolean>;

      // Terminal (PTY)
      startTerminal(a: {
        id: string;
        cwd: string;
        machine: string;
        cols: number;
        rows: number;
      }): Promise<{ ok: true; replay: string } | { ok: false; error: string }>;
      sendTerminalInput(a: { id: string; data: string }): void;
      resizeTerminal(a: { id: string; cols: number; rows: number }): void;
      killTerminal(id: string): Promise<{ ok: boolean }>;
      onTerminalData(cb: (a: { id: string; data: string }) => void): () => void;
      onTerminalExit(cb: (a: { id: string }) => void): () => void;

      // Stream
      onUpdate(cb: () => void): () => void;
    };
  }
}
