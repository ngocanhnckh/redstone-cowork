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
      }): Promise<{ forwardPorts: number[]; browserUrl: string; previewPort?: number | null } | null>;
      saveWorkspaceConfig(a: {
        sessionId: string;
        cwd: string;
        machine: string;
        config: { forwardPorts: number[]; browserUrl: string; previewPort?: number | null };
      }): Promise<{ ok: boolean; error?: string }>;

      // Per-machine SSH host
      getSshHost(machine: string): Promise<string>;
      setSshHost(machine: string, host: string): Promise<{ ok: boolean; error?: string }>;
      isLocalMachine(machine: string): Promise<boolean>;

      // Passwordless SSH onboarding
      sshSetup(a: {
        sessionId: string;
        machine: string;
        hostNameOverride?: string;
      }): Promise<SshSetupResult>;
      getSshResult(sessionId: string): Promise<{
        ok: boolean;
        user?: string;
        address?: string | null;
        port?: number;
        error?: string;
        at?: string;
      } | null>;

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

      // Port forwarding (ssh -N -L)
      startForward(a: {
        sessionId: string;
        machine: string;
        port: number;
      }): Promise<{ ok: boolean; error?: string }>;
      stopForward(a: { sessionId: string; port: number }): Promise<{ ok: boolean }>;
      listForwards(
        sessionId: string
      ): Promise<Array<{ port: number; status: ForwardStatus; error?: string }>>;
      onForwardStatus(
        cb: (a: {
          sessionId: string;
          port: number;
          status: ForwardStatus;
          error?: string;
        }) => void
      ): () => void;

      // Open a URL in the real browser
      openExternal(url: string): Promise<{ ok: boolean; error?: string }>;

      // File browser
      listFiles(a: {
        cwd: string;
        machine: string;
        dir: string;
      }): Promise<
        | { ok: true; entries: DirEntry[] }
        | { ok: false; error: string }
      >;
      readFile(a: {
        cwd: string;
        machine: string;
        file: string;
      }): Promise<FileRead>;
      writeFile(a: {
        cwd: string;
        machine: string;
        file: string;
        content: string;
      }): Promise<{ ok: boolean; error?: string }>;
      deletePath(a: {
        cwd: string;
        machine: string;
        path: string;
      }): Promise<{ ok: boolean; error?: string }>;
      makeDir(a: {
        cwd: string;
        machine: string;
        parent: string;
        name: string;
      }): Promise<{ ok: boolean; error?: string; path?: string }>;
      createFile(a: {
        cwd: string;
        machine: string;
        parent: string;
        name: string;
      }): Promise<{ ok: boolean; error?: string; path?: string }>;
      uploadFiles(a: {
        cwd: string;
        machine: string;
        destDir: string;
      }): Promise<{ ok: boolean; uploaded: number; error?: string }>;
      copyText(text: string): Promise<{ ok: boolean; error?: string }>;

      // LLM assistant
      getLlmModels(): Promise<LlmModelInfo[]>;
      llmAssist(a: {
        sessionId: string;
        kind: "chat" | "optimize" | "summarize";
        modelId?: string;
        input?: string;
      }): Promise<string>;
      addLlmEndpoint(a: {
        label: string;
        baseUrl: string;
        apiKey: string;
        model: string;
        maxTokens?: number;
      }): Promise<LlmModelInfo>;
      deleteLlmEndpoint(id: string): Promise<void>;

      // Stream
      onUpdate(cb: () => void): () => void;
    };
  }

  type ForwardStatus = "local" | "starting" | "active" | "failed" | "stopped";

  type LlmModelInfo = { id: string; label: string; model: string; kind: "preset" | "custom"; maxTokens?: number | null };

  type DirEntry = { name: string; path: string; kind: "dir" | "file"; size: number };

  type FileRead =
    | { ok: true; encoding: "text"; content: string; size: number; truncated: boolean }
    | { ok: true; encoding: "base64"; content: string; size: number; mime: string }
    | { ok: true; encoding: "binary"; size: number; mime: string }
    | { ok: false; error: string };

  type SshSetupResult =
    | { stage: "keygen"; ok: false; error: string }
    | { stage: "authorize"; ok: false; error: string }
    | { stage: "need-host"; ok: false; needHostName: true; user?: string; port?: number }
    | { stage: "done"; ok: boolean; error?: string; alias: string; hostName: string };
}
