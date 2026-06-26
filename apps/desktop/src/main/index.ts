import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { saveConfig, loadConfig, clearConfig } from "./config";

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

ipcMain.handle("config:get", () => loadConfig());
ipcMain.handle("config:save", (_e, args: { serverUrl: string; token: string }) => {
  saveConfig(args.serverUrl, args.token);
  return { ok: true };
});
ipcMain.handle("config:clear", () => { clearConfig(); });

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
