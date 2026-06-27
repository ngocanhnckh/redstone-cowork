import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { saveConfig, loadConfig, clearConfig } from "./config";
import * as api from "./api";
import { getWorkspaceConfig, saveWorkspaceConfig } from "./workspace";
import { IPC } from "../shared/ipc";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tray state
// ---------------------------------------------------------------------------
let tray: Tray | null = null;
let waitingIds = new Set<string>();
let trayRefreshRunning = false;

async function refreshTrayAndNotify(): Promise<void> {
  if (!tray) return;
  if (trayRefreshRunning) return;
  trayRefreshRunning = true;
  try {
    const queue = (await api.getQueue()) as Array<{ id: string; cwd: string }>;

    // Update tray title / tooltip
    tray.setTitle(queue.length ? ` ${queue.length}` : "");
    tray.setToolTip(
      queue.length ? `${queue.length} waiting` : "Redstone Cowork — all clear"
    );

    // Determine newly-appeared sessions
    const newIds = queue.filter((q) => !waitingIds.has(q.id));

    // Only notify when the user is NOT already looking at the window
    const isFocused = BrowserWindow.getFocusedWindow() !== null;

    if (!isFocused && Notification.isSupported()) {
      // Fetch pending decisions once for body enrichment
      let decisions: Array<{ sessionId: string; prompt?: { title?: string } }> = [];
      try {
        decisions = (await api.getPendingDecisions()) as typeof decisions;
      } catch {
        // best-effort
      }

      for (const q of newIds) {
        const repoName = basename(q.cwd || "session");
        const decision = decisions.find((d) => d.sessionId === q.id);
        const body = decision?.prompt?.title
          ? `${repoName} — ${decision.prompt.title}`
          : repoName;

        try {
          const n = new Notification({ title: "Claude needs you", body });
          n.on("click", () => {
            const w = BrowserWindow.getAllWindows()[0];
            w?.show();
            w?.focus();
          });
          n.show();
        } catch {
          // Notifications not available — ignore
        }
      }
    }

    waitingIds = new Set(queue.map((q) => q.id));
  } catch {
    // API not reachable — ignore
  } finally {
    trayRefreshRunning = false;
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    // Align the macOS traffic lights vertically into the app's 40px title bar.
    trafficLightPosition: { x: 19, y: 14 },
    // Native macOS translucency: blur the desktop/windows behind us. Transparent
    // bg lets the vibrant material show through where the page is transparent.
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(here, "../preload/index.mjs"),
      // sandbox: false required — preload uses contextBridge + ipcRenderer which need Node/Electron access
      sandbox: false,
    },
  });

  // Enforce vibrancy at runtime too — the constructor option is a no-op on some
  // macOS/Electron combos, but setVibrancy after creation reliably applies it.
  if (process.platform === "darwin") win.setVibrancy("under-window");

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
      // Keep tray in sync with every server event (fire-and-forget)
      refreshTrayAndNotify().catch(() => {/* ignore */});
    });
    // Initial tray sync after connecting
    refreshTrayAndNotify().catch(() => {/* ignore */});
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
ipcMain.handle(IPC.instruct, (_e, a: { sessionId: string; text: string }) =>
  api.instruct(a.sessionId, a.text)
);
ipcMain.handle(IPC.mode, (_e, a: { sessionId: string; mode: string }) =>
  api.switchMode(a.sessionId, a.mode)
);

// Workspace config (per-session .redstone/session.json)
ipcMain.handle(IPC.workspaceGet, (_e, a: Parameters<typeof getWorkspaceConfig>[0]) =>
  getWorkspaceConfig(a)
);
ipcMain.handle(IPC.workspaceSave, (_e, a: Parameters<typeof saveWorkspaceConfig>[0]) =>
  saveWorkspaceConfig(a)
);

app.whenReady().then(() => {
  // Create system tray
  try {
    // Use an empty image — on macOS tray title text is visible even without an icon image
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setTitle("");
    tray.setToolTip("Redstone Cowork — all clear");
    const menu = Menu.buildFromTemplate([
      {
        label: "Show",
        click: () => {
          const w = BrowserWindow.getAllWindows()[0];
          w?.show();
          w?.focus();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  } catch {
    // Tray not available in this environment — ignore
  }

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
