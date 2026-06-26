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

  // Stream
  onUpdate: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.streamEvent, handler);
    return () => ipcRenderer.removeListener(IPC.streamEvent, handler);
  },
});
