export {};
declare global {
  interface Window {
    cowork: {
      // Config
      getConfig(): Promise<{ serverUrl: string; hasToken: boolean; isOrg: boolean } | null>;
      saveConfig(serverUrl: string, token: string): Promise<{ ok: boolean }>;
      clearConfig(): Promise<void>;
      authConfig(serverUrl: string): Promise<{ redstone: boolean; issuer: string | null; accounts?: boolean; orgName?: string | null }>;
      redstoneLogin(serverUrl: string, username: string, password: string): Promise<{ ok: boolean; error?: string }>;
      accountLogin(
        serverUrl: string,
        username: string,
        password: string,
      ): Promise<{ ok: boolean; error?: string; account?: { username: string; displayName: string; role: string } }>;

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

      // Named Claude endpoint/model config profiles
      listClaudeConfigs(): Promise<Array<{ name: string }>>;
      getClaudeConfig(name: string): Promise<{ name: string; env: Record<string, string> }>;
      putClaudeConfig(name: string, env: Record<string, string>): Promise<{ ok: true }>;
      deleteClaudeConfig(name: string): Promise<{ ok: true }>;

      // Jira (per-session project management)
      jiraProfilesList(): Promise<Array<{ name: string; baseUrl: string; account: string | null }>>;
      jiraProfilePut(name: string, baseUrl: string, pat: string): Promise<{ name: string; baseUrl: string; account: string | null }>;
      jiraProfileDelete(name: string): Promise<{ ok: true }>;
      jiraProfileValidate(name: string): Promise<{ ok: boolean; account?: string; error?: string }>;
      jiraGetBinding(sessionId: string): Promise<{ profile: string; projectKey: string; boardId: number | null } | null>;
      jiraSetBinding(sessionId: string, binding: { profile: string; projectKey: string; boardId?: number | null }): Promise<unknown>;
      jiraClearBinding(sessionId: string): Promise<{ ok: true }>;
      jiraSessionIssues(sessionId: string): Promise<Array<{ key: string; summary: string; status: string; statusCategory: "todo" | "inprogress" | "done"; assignee: string | null; url: string }>>;
      jiraIssueDetail(sessionId: string, key: string): Promise<{ key: string; summary: string; status: string; statusCategory: string; assignee: string | null; url: string; descriptionHtml: string; description: string; issueType: string; subtaskAllowed: boolean; subtasks: Array<{ key: string; summary: string; status: string; statusCategory: "todo" | "inprogress" | "done"; assignee: string | null; url: string }>; comments: Array<{ author: string | null; created: string; bodyHtml: string }> }>;
      jiraCreateIssue(sessionId: string, summary: string): Promise<{ key: string; summary: string; status: string; statusCategory: "todo" | "inprogress" | "done"; assignee: string | null; url: string }>;
      jiraUpdateIssue(sessionId: string, key: string, fields: { summary?: string; description?: string }): Promise<{ ok: boolean }>;
      jiraCreateSubtask(sessionId: string, key: string, summary: string, description?: string): Promise<{ key: string; summary: string; status: string; statusCategory: "todo" | "inprogress" | "done"; assignee: string | null; url: string }>;
      jiraIssueTransitions(sessionId: string, key: string): Promise<Array<{ id: string; name: string; to: string }>>;
      jiraTransitionIssue(sessionId: string, key: string, transitionId: string): Promise<{ ok: boolean }>;

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
      warmHost(machine: string): Promise<{ ok: boolean }>;
      hostIps(machine: string): Promise<{ local: string | null; public: string | null }>;
      hostConnections(machine: string): Promise<{ ip: string; port: number | null; count: number }[]>;
      hostProcesses(machine: string): Promise<{ pid: number; name: string; cpu: number; mem: number }[]>;
      calendarEvents(): Promise<{ ok: boolean; denied: boolean; events: { title: string; start: string; end: string; allDay: boolean; calendar: string }[] }>;
      networkMap(machine: string): Promise<import("./types").NetworkMap>;
      weather(): Promise<import("./types").Weather>;

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
      openTerminalWindow(a: { sessionId: string; cwd: string; machine: string; title?: string }): Promise<{ ok: boolean }>;
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

      // Custom-app <webview> guests: register a guest's home URL so cross-domain
      // navigations pop out to the real browser (keyed by wv.getWebContentsId()).
      registerAppGuest(webContentsId: number, homeUrl: string): Promise<{ ok: boolean }>;
      unregisterAppGuest(webContentsId: number): Promise<{ ok: boolean }>;
      setAppTransparent(webContentsId: number, on: boolean): Promise<{ ok: boolean }>;
      injectAppCss(webContentsId: number, css: string): Promise<{ ok: boolean }>;
      // Main asks the renderer to open a URL in the focused session's workspace
      // browser (a custom app left its domain). Returns an unsubscribe fn.
      onOpenInWorkspaceBrowser(cb: (a: { url: string }) => void): () => void;
      onBrowserFind(cb: (a: { guestId: number; action: "open" | "close" }) => void): () => void;
      onDisplayMediaRequest(cb: (a: { screens: Array<{ id: string; name: string; kind: string; thumb: string }>; tabs: Array<{ id: string; title: string; url: string }> }) => void): () => void;
      displayMediaPick(choice: { kind: "screen" | "window" | "tab"; id: string }): Promise<{ ok: boolean }>;
      displayMediaCancel(): Promise<{ ok: boolean }>;
      prepareBrowserPartition(partition: string): Promise<{ ok: boolean }>;
      openBrowserWindow(url: string, partition?: string): Promise<{ ok: boolean; error?: string }>;
      onGuestKey(cb: (k: { type: "keyDown" | "keyUp"; key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }) => void): () => void;
      syncKeybindings(accels: string[]): Promise<{ ok: boolean }>;
      focusMainWindow(): void;

      // Appearance — custom background image + macOS fullscreen-keeps-wallpaper.
      chooseBgImage(): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
      getBgImage(): Promise<string | null>;
      clearBgImage(): Promise<{ ok: boolean }>;
      setSimpleFullscreen(on: boolean): Promise<{ fullscreen: boolean }>;
      getFullscreenState(): Promise<{ fullscreen: boolean }>;
      setVibrancy(on: boolean): Promise<{ ok: boolean }>;
      chooseBgVideo(): Promise<{ ok: boolean; url?: string; error?: string }>;
      getBgVideo(): Promise<string | null>;
      clearBgVideo(): Promise<{ ok: boolean }>;

      // Browser inspector (console + network devtools).
      registerSessionBrowser(sessionId: string, webContentsId: number): Promise<{ ok: boolean }>;
      unregisterSessionBrowser(sessionId: string, webContentsId?: number): Promise<{ ok: boolean }>;
      startDevtools(sessionId: string): Promise<{ ok: boolean }>;
      stopDevtools(sessionId: string): Promise<{ ok: boolean }>;
      getDevtoolsBody(sessionId: string, requestId: string): Promise<{ body: string; base64Encoded: boolean } | null>;
      onDevtoolsEvent(cb: (a: { sessionId: string; ev: Record<string, unknown> }) => void): () => void;

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
      /**
       * Streaming search: `onBatch` fires repeatedly as matches arrive, `onDone`
       * exactly once at the end. The returned fn stops the remote grep and
       * suppresses `onDone`. Preferred over `searchFiles` in the UI.
       */
      searchFilesStream(
        a: {
          cwd: string;
          machine: string;
          query: string;
          caseSensitive?: boolean;
          regex?: boolean;
          maxResults?: number;
        },
        onBatch: (matches: Array<{ path: string; line: number; text: string }>) => void,
        onDone: (r: { truncated: boolean; error?: string }) => void
      ): () => void;
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
      writeFileBase64(a: {
        cwd: string;
        machine: string;
        file: string;
        base64: string;
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
      downloadFile(a: {
        cwd: string;
        machine: string;
        file: string;
      }): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
      copyText(text: string): Promise<{ ok: boolean; error?: string }>;
      readClipboard(): Promise<string>;

      // Chrome extensions (shared workspace browser session)
      extensionsList(): Promise<BrowserExtension[]>;
      extensionAdd(): Promise<{ ok: boolean; error?: string; added?: BrowserExtension }>;
      extensionInstallWebStore(idOrUrl: string): Promise<{ ok: boolean; error?: string; added?: BrowserExtension }>;
      extensionSetEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>;
      extensionRemove(id: string): Promise<{ ok: boolean }>;

      // Encrypted credential vault (workspace browser)
      vaultAvailable(): Promise<boolean>;
      vaultList(): Promise<Array<{ origin: string; username: string }>>;
      vaultGetForOrigin(origin: string): Promise<{ username: string; password: string } | null>;
      vaultSave(origin: string, username: string, password: string): Promise<{ ok: boolean }>;
      vaultDelete(origin: string, username: string): Promise<{ ok: boolean }>;

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

  type BrowserExtension = { id: string; name: string; version: string; enabled: boolean; loaded: boolean; error?: string };

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
