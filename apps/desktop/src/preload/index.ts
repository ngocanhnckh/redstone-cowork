import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cowork", {
  getConfig: (): Promise<{ serverUrl: string; hasToken: boolean } | null> => ipcRenderer.invoke("config:get"),
  saveConfig: (serverUrl: string, token: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("config:save", { serverUrl, token }),
  clearConfig: (): Promise<void> => ipcRenderer.invoke("config:clear"),
});
