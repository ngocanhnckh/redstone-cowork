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

      // Stream
      onUpdate(cb: () => void): () => void;
    };
  }
}
