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
  }): Promise<{ sshHost: string; forwardPorts: number[]; browserUrl: string } | null> =>
    ipcRenderer.invoke(IPC.workspaceGet, a),
  saveWorkspaceConfig: (a: {
    sessionId: string;
    cwd: string;
    machine: string;
    config: { sshHost: string; forwardPorts: number[]; browserUrl: string };
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.workspaceSave, a),

  // Stream
  onUpdate: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.streamEvent, handler);
    return () => ipcRenderer.removeListener(IPC.streamEvent, handler);
  },
});
