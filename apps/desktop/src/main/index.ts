import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { saveConfig, loadConfig, clearConfig } from "./config";
import * as api from "./api";
import { IPC } from "../shared/ipc";

const here = dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#15110D",
    webPreferences: {
      preload: join(here, "../preload/index.mjs"),
      // sandbox: false required — preload uses contextBridge + ipcRenderer which need Node/Electron access
      sandbox: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(here, "../renderer/index.html"));
  }
}

let stopStream: (() => void) | null = null;

function startForwarding(): void {
  try {
    stopStream?.();
    stopStream = api.startStream((e) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(IPC.streamEvent, e);
      }
    });
  } catch {
    // Bad server config — don't crash the app; stream will retry when config changes.
  }
}

// Config IPC handlers
ipcMain.handle(IPC.configGet, () => loadConfig());
ipcMain.handle(IPC.configSave, (_e, args: { serverUrl: string; token: string }) => {
  saveConfig(args.serverUrl, args.token);
  startForwarding();
  return { ok: true };
});
ipcMain.handle(IPC.configClear, () => { clearConfig(); });

// Data IPC handlers
ipcMain.handle(IPC.sessions, () => api.getSessions());
ipcMain.handle(IPC.queue, () => api.getQueue());
ipcMain.handle(IPC.decisions, () => api.getPendingDecisions());
ipcMain.handle(IPC.resolve, (_e, a: { id: string; resolution: Parameters<typeof api.resolveDecision>[1] }) =>
  api.resolveDecision(a.id, a.resolution)
);
ipcMain.handle(IPC.snooze, (_e, a: { id: string; minutes: number }) =>
  api.snooze(a.id, a.minutes)
);
ipcMain.handle(IPC.pin, (_e, a: { id: string; pinned: boolean }) =>
  api.pin(a.id, a.pinned)
);

app.whenReady().then(() => {
  createWindow();
  if (loadConfig()?.hasToken) {
    startForwarding();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopStream?.();
  stopStream = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopStream?.();
  stopStream = null;
});
