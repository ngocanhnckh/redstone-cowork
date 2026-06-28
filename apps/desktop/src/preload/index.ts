import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";

contextBridge.exposeInMainWorld("cowork", {
  // Config
  getConfig: (): Promise<{ serverUrl: string; hasToken: boolean } | null> =>
    ipcRenderer.invoke(IPC.configGet),
  saveConfig: (serverUrl: string, token: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.configSave, { serverUrl, token }),
  clearConfig: (): Promise<void> =>
    ipcRenderer.invoke(IPC.configClear),

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
  instruct: (sessionId: string, text: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.instruct, { sessionId, text }),
  switchMode: (sessionId: string, mode: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.mode, { sessionId, mode }),

  // Workspace config
  getWorkspaceConfig: (a: {
    sessionId: string;
    cwd: string;
    machine: string;
  }): Promise<{ forwardPorts: number[]; browserUrl: string } | null> =>
    ipcRenderer.invoke(IPC.workspaceGet, a),
  saveWorkspaceConfig: (a: {
    sessionId: string;
    cwd: string;
    machine: string;
    config: { forwardPorts: number[]; browserUrl: string };
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.workspaceSave, a),

  // Per-machine SSH host
  getSshHost: (machine: string): Promise<string> =>
    ipcRenderer.invoke(IPC.workspaceGetSshHost, { machine }),
  setSshHost: (machine: string, host: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.workspaceSetSshHost, { machine, host }),
  isLocalMachine: (machine: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.workspaceIsLocal, { machine }),

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

  // Stream
  onUpdate: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.streamEvent, handler);
    return () => ipcRenderer.removeListener(IPC.streamEvent, handler);
  },
});
