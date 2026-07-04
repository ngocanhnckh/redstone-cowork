import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type { SshSetupResult } from "../main/ssh-setup";

contextBridge.exposeInMainWorld("cowork", {
  // Config
  getConfig: (): Promise<{ serverUrl: string; hasToken: boolean; isOrg: boolean } | null> =>
    ipcRenderer.invoke(IPC.configGet),
  saveConfig: (serverUrl: string, token: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.configSave, { serverUrl, token }),
  clearConfig: (): Promise<void> =>
    ipcRenderer.invoke(IPC.configClear),
  authConfig: (serverUrl: string): Promise<{ redstone: boolean; issuer: string | null }> =>
    ipcRenderer.invoke(IPC.authConfig, { serverUrl }),
  redstoneLogin: (serverUrl: string, username: string, password: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.redstoneLogin, { serverUrl, username, password }),

  // Data
  getSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.sessions),
  getQueue: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.queue),
  getPendingDecisions: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.decisions),
  resolveDecision: (
    id: string,
    resolution: { choice?: string | null; answers?: Record<string, string | string[]> | null; custom?: string | null }
  ): Promise<unknown> =>
    ipcRenderer.invoke(IPC.resolve, { id, resolution }),
  snooze: (id: string, minutes: number): Promise<void> =>
    ipcRenderer.invoke(IPC.snooze, { id, minutes }),
  pin: (id: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.pin, { id, pinned }),
  dismissSession: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.dismiss, { id }),
  instruct: (sessionId: string, text: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.instruct, { sessionId, text }),
  interrupt: (sessionId: string, text?: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.interrupt, { sessionId, text }),
  switchMode: (sessionId: string, mode: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.mode, { sessionId, mode }),
  addUserTodo: (sessionId: string, text: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.userTodoAdd, { sessionId, text }),
  toggleUserTodo: (sessionId: string, todoId: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.userTodoToggle, { sessionId, todoId }),
  deleteUserTodo: (sessionId: string, todoId: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.userTodoDelete, { sessionId, todoId }),
  addTag: (sessionId: string, tag: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.tagAdd, { sessionId, tag }),
  removeTag: (sessionId: string, tag: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.tagRemove, { sessionId, tag }),
  getInventory: (): Promise<{ hosts: unknown[]; sessions: unknown[] }> =>
    ipcRenderer.invoke(IPC.inventoryList),
  getTelemetry: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.telemetryList),
  getDocker: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.dockerList),
  getCaps: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.capsList),
  gitInfo: (cwd: string, machine: string): Promise<{ ok: boolean; repo: boolean; branch: string | null; ahead: number; behind: number; dirty: number; commits: Array<{ hash: string; author: string; relative: string; date: string; subject: string }>; error?: string }> =>
    ipcRenderer.invoke(IPC.gitInfo, { cwd, machine }),
  inventoryHistory: (id: string): Promise<{ ok: boolean; messages?: Array<{ role: string; text: string }>; error?: string }> =>
    ipcRenderer.invoke(IPC.inventoryHistory, { id }),
  inventoryRun: (id: string, message: string): Promise<{ ok: boolean; reply?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.inventoryRun, { id, message }),
  inventoryAddTag: (id: string, tag: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.inventoryTagAdd, { id, tag }),
  inventoryRemoveTag: (id: string, tag: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.inventoryTagRemove, { id, tag }),
  listAccessKeys: (): Promise<Array<{ id: string; name: string; prefix: string; scope: string; lastUsedAt: string | null; revokedAt: string | null }>> =>
    ipcRenderer.invoke(IPC.accessKeysList),
  createAccessKey: (name: string, scope: "read" | "control"): Promise<{ id: string; key: string; scope: string }> =>
    ipcRenderer.invoke(IPC.accessKeyCreate, { name, scope }),
  revokeAccessKey: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.accessKeyRevoke, { id }),

  // Workspace config
  getWorkspaceConfig: (a: {
    sessionId: string;
    cwd: string;
    machine: string;
  }): Promise<{ forwardPorts: number[]; browserUrl: string; previewPort?: number | null } | null> =>
    ipcRenderer.invoke(IPC.workspaceGet, a),
  saveWorkspaceConfig: (a: {
    sessionId: string;
    cwd: string;
    machine: string;
    config: { forwardPorts: number[]; browserUrl: string; previewPort?: number | null };
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.workspaceSave, a),

  // Per-machine SSH host
  getSshHost: (machine: string): Promise<string> =>
    ipcRenderer.invoke(IPC.workspaceGetSshHost, { machine }),
  setSshHost: (machine: string, host: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.workspaceSetSshHost, { machine, host }),
  isLocalMachine: (machine: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.workspaceIsLocal, { machine }),
  hostIps: (machine: string): Promise<{ local: string | null; public: string | null }> =>
    ipcRenderer.invoke(IPC.hostIps, { machine }),

  // Passwordless SSH onboarding
  sshSetup: (a: {
    sessionId: string;
    machine: string;
    hostNameOverride?: string;
  }): Promise<SshSetupResult> =>
    ipcRenderer.invoke(IPC.sshSetup, a),
  getSshResult: (
    sessionId: string
  ): Promise<{
    ok: boolean;
    user?: string;
    address?: string | null;
    port?: number;
    error?: string;
    at?: string;
  } | null> => ipcRenderer.invoke(IPC.sshResultGet, sessionId),

  // Terminal (PTY)
  startTerminal: (a: {
    id: string;
    cwd: string;
    machine: string;
    cols: number;
    rows: number;
  }): Promise<{ ok: true; replay: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.terminalStart, a),
  sendTerminalInput: (a: { id: string; data: string }): void =>
    ipcRenderer.send(IPC.terminalInput, a),
  resizeTerminal: (a: { id: string; cols: number; rows: number }): void =>
    ipcRenderer.send(IPC.terminalResize, a),
  killTerminal: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.terminalKill, { id }),
  onTerminalData: (cb: (a: { id: string; data: string }) => void): (() => void) => {
    const handler = (_e: unknown, a: { id: string; data: string }) => cb(a);
    ipcRenderer.on(IPC.terminalData, handler);
    return () => ipcRenderer.removeListener(IPC.terminalData, handler);
  },
  onTerminalExit: (cb: (a: { id: string }) => void): (() => void) => {
    const handler = (_e: unknown, a: { id: string }) => cb(a);
    ipcRenderer.on(IPC.terminalExit, handler);
    return () => ipcRenderer.removeListener(IPC.terminalExit, handler);
  },

  // Docker log streaming
  startDockerLog: (a: {
    id: string;
    machine: string;
    container: string;
  }): Promise<{ ok: true; replay: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.dockerLogStart, a),
  stopDockerLog: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.dockerLogStop, { id }),
  onDockerLogData: (cb: (a: { id: string; data: string }) => void): (() => void) => {
    const handler = (_e: unknown, a: { id: string; data: string }) => cb(a);
    ipcRenderer.on(IPC.dockerLogData, handler);
    return () => ipcRenderer.removeListener(IPC.dockerLogData, handler);
  },
  onDockerLogExit: (cb: (a: { id: string }) => void): (() => void) => {
    const handler = (_e: unknown, a: { id: string }) => cb(a);
    ipcRenderer.on(IPC.dockerLogExit, handler);
    return () => ipcRenderer.removeListener(IPC.dockerLogExit, handler);
  },

  // Port forwarding (ssh -N -L)
  startForward: (a: {
    sessionId: string;
    machine: string;
    port: number;
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.forwardStart, a),
  stopForward: (a: { sessionId: string; port: number }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.forwardStop, a),
  listForwards: (
    sessionId: string
  ): Promise<Array<{ port: number; status: string; error?: string }>> =>
    ipcRenderer.invoke(IPC.forwardList, { sessionId }),
  onForwardStatus: (
    cb: (a: { sessionId: string; port: number; status: string; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _e: unknown,
      a: { sessionId: string; port: number; status: string; error?: string }
    ) => cb(a);
    ipcRenderer.on(IPC.forwardStatus, handler);
    return () => ipcRenderer.removeListener(IPC.forwardStatus, handler);
  },

  // Open a URL in the real browser
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.openExternal, { url }),

  // Custom-app <webview> guests: register a guest's home URL so the main process
  // pops cross-domain navigations out to the real browser instead of hijacking
  // the mini-app. Keyed by the guest's webContents id (wv.getWebContentsId()).
  registerAppGuest: (webContentsId: number, homeUrl: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.appGuestRegister, { webContentsId, homeUrl }),
  unregisterAppGuest: (webContentsId: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.appGuestUnregister, { webContentsId }),
  // Main asks the renderer to open a URL in the focused session's workspace browser
  // (a custom app tried to leave its domain). Returns an unsubscribe fn.
  onOpenInWorkspaceBrowser: (cb: (a: { url: string }) => void): (() => void) => {
    const handler = (_e: unknown, a: { url: string }) => cb(a);
    ipcRenderer.on(IPC.openInWorkspaceBrowser, handler);
    return () => ipcRenderer.removeListener(IPC.openInWorkspaceBrowser, handler);
  },

  // Appearance — custom background image + macOS fullscreen-keeps-wallpaper.
  chooseBgImage: (): Promise<{ ok: boolean; dataUrl?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.bgImageChoose),
  getBgImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.bgImageGet),
  clearBgImage: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.bgImageClear),
  setSimpleFullscreen: (on: boolean): Promise<{ fullscreen: boolean }> =>
    ipcRenderer.invoke(IPC.simpleFullscreen, { on }),
  getFullscreenState: (): Promise<{ fullscreen: boolean }> => ipcRenderer.invoke(IPC.fullscreenState),

  // File browser
  listFiles: (a: {
    cwd: string;
    machine: string;
    dir: string;
  }): Promise<
    | { ok: true; entries: Array<{ name: string; path: string; kind: "dir" | "file"; size: number }> }
    | { ok: false; error: string }
  > => ipcRenderer.invoke(IPC.filesList, a),
  searchFiles: (a: {
    cwd: string;
    machine: string;
    query: string;
    caseSensitive?: boolean;
    regex?: boolean;
    maxResults?: number;
  }): Promise<
    | { ok: true; matches: Array<{ path: string; line: number; text: string }>; truncated: boolean }
    | { ok: false; error: string }
  > => ipcRenderer.invoke(IPC.filesSearch, a),
  readFile: (a: {
    cwd: string;
    machine: string;
    file: string;
  }): Promise<
    | { ok: true; encoding: "text"; content: string; size: number; truncated: boolean }
    | { ok: true; encoding: "base64"; content: string; size: number; mime: string }
    | { ok: true; encoding: "binary"; size: number; mime: string }
    | { ok: false; error: string }
  > => ipcRenderer.invoke(IPC.filesRead, a),
  writeFile: (a: {
    cwd: string;
    machine: string;
    file: string;
    content: string;
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.filesWrite, a),
  deletePath: (a: {
    cwd: string;
    machine: string;
    path: string;
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.filesDelete, a),
  makeDir: (a: {
    cwd: string;
    machine: string;
    parent: string;
    name: string;
  }): Promise<{ ok: boolean; error?: string; path?: string }> => ipcRenderer.invoke(IPC.filesMkdir, a),
  createFile: (a: {
    cwd: string;
    machine: string;
    parent: string;
    name: string;
  }): Promise<{ ok: boolean; error?: string; path?: string }> => ipcRenderer.invoke(IPC.filesCreate, a),
  uploadFiles: (a: {
    cwd: string;
    machine: string;
    destDir: string;
  }): Promise<{ ok: boolean; uploaded: number; error?: string }> => ipcRenderer.invoke(IPC.filesUpload, a),
  copyText: (text: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.clipboardWrite, { text }),

  // LLM assistant
  getLlmModels: (): Promise<Array<{ id: string; label: string; model: string; kind: "preset" | "custom" }>> =>
    ipcRenderer.invoke(IPC.llmModels),
  llmAssist: (a: {
    sessionId: string;
    kind: "chat" | "optimize" | "summarize";
    modelId?: string;
    input?: string;
  }): Promise<string> => ipcRenderer.invoke(IPC.llmAssist, a),
  llmChat: (a: {
    modelId: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  }): Promise<string> => ipcRenderer.invoke(IPC.llmChat, a),
  addLlmEndpoint: (a: {
    label: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    maxInputTokens?: number;
    role?: "text" | "flash" | "vision";
  }): Promise<{ id: string; label: string; model: string; kind: "preset" | "custom"; maxTokens?: number | null; maxInputTokens?: number | null }> =>
    ipcRenderer.invoke(IPC.llmAddEndpoint, a),
  deleteLlmEndpoint: (id: string): Promise<void> => ipcRenderer.invoke(IPC.llmDeleteEndpoint, { id }),
  agentEnabled: (): Promise<boolean> => ipcRenderer.invoke(IPC.llmAgentEnabled),
  llmAgent: (a: {
    sessionId: string;
    input: string;
    modelId?: string;
  }): Promise<{ text: string; steps: Array<{ tool: string; args: string; result: string }> }> =>
    ipcRenderer.invoke(IPC.llmAgent, a),

  // Stream
  onUpdate: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.streamEvent, handler);
    return () => ipcRenderer.removeListener(IPC.streamEvent, handler);
  },
});
