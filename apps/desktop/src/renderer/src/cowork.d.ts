export {};
declare global {
  interface Window {
    cowork: {
      // Config
      getConfig(): Promise<{ serverUrl: string; hasToken: boolean; isOrg: boolean } | null>;
      saveConfig(serverUrl: string, token: string): Promise<{ ok: boolean }>;
      clearConfig(): Promise<void>;
      authConfig(serverUrl: string): Promise<{ redstone: boolean; issuer: string | null }>;
      redstoneLogin(serverUrl: string, username: string, password: string): Promise<{ ok: boolean; error?: string }>;

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
      dismissSession(id: string): Promise<void>;
      instruct(sessionId: string, text: string): Promise<unknown>;
      interrupt(sessionId: string, text?: string): Promise<unknown>;
      switchMode(sessionId: string, mode: string): Promise<unknown>;
      addUserTodo(sessionId: string, text: string): Promise<unknown>;
      toggleUserTodo(sessionId: string, todoId: string): Promise<unknown>;
      deleteUserTodo(sessionId: string, todoId: string): Promise<unknown>;
      addTag(sessionId: string, tag: string): Promise<unknown>;
      removeTag(sessionId: string, tag: string): Promise<unknown>;
      getInventory(): Promise<{ hosts: unknown[]; sessions: unknown[] }>;
      getTelemetry(): Promise<import("./types").HostTelemetryView[]>;
      getDocker(): Promise<import("./types").DockerHostView[]>;
      getCaps(): Promise<import("./types").CapsHostView[]>;
      gitInfo(cwd: string, machine: string): Promise<import("./types").GitInfo>;
      inventoryHistory(id: string): Promise<{ ok: boolean; messages?: Array<{ role: string; text: string }>; error?: string }>;
      inventoryRun(id: string, message: string): Promise<{ ok: boolean; reply?: string; error?: string }>;
      inventoryAddTag(id: string, tag: string): Promise<unknown>;
      inventoryRemoveTag(id: string, tag: string): Promise<unknown>;
      listAccessKeys(): Promise<Array<{ id: string; name: string; prefix: string; scope: string; lastUsedAt: string | null; revokedAt: string | null }>>;
      createAccessKey(name: string, scope: "read" | "control"): Promise<{ id: string; key: string; scope: string }>;
      revokeAccessKey(id: string): Promise<{ ok: boolean }>;

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
      hostIps(machine: string): Promise<{ local: string | null; public: string | null }>;

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

      // Docker log streaming
      startDockerLog(a: {
        id: string;
        machine: string;
        container: string;
      }): Promise<{ ok: true; replay: string } | { ok: false; error: string }>;
      stopDockerLog(id: string): Promise<{ ok: boolean }>;
      onDockerLogData(cb: (a: { id: string; data: string }) => void): () => void;
      onDockerLogExit(cb: (a: { id: string }) => void): () => void;

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
      searchFiles(a: {
        cwd: string;
        machine: string;
        query: string;
        caseSensitive?: boolean;
        regex?: boolean;
        maxResults?: number;
      }): Promise<
        | { ok: true; matches: Array<{ path: string; line: number; text: string }>; truncated: boolean }
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
      llmChat(a: {
        modelId: string;
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      }): Promise<string>;
      addLlmEndpoint(a: {
        label: string;
        baseUrl: string;
        apiKey: string;
        model: string;
        maxTokens?: number;
        maxInputTokens?: number;
        role?: "text" | "flash" | "vision";
      }): Promise<LlmModelInfo>;
      deleteLlmEndpoint(id: string): Promise<void>;
      agentEnabled(): Promise<boolean>;
      llmAgent(a: {
        sessionId: string;
        input: string;
        modelId?: string;
      }): Promise<{ text: string; steps: Array<{ tool: string; args: string; result: string }> }>;

      // Stream
      onUpdate(cb: () => void): () => void;
    };
  }

  type ForwardStatus = "local" | "starting" | "active" | "failed" | "stopped";

  type LlmModelInfo = { id: string; label: string; model: string; kind: "preset" | "custom"; maxTokens?: number | null; maxInputTokens?: number | null };

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
