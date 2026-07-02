import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell, dialog, clipboard } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { saveConfig, loadConfig, clearConfig } from "./config";
import * as api from "./api";
import { getWorkspaceConfig, saveWorkspaceConfig, getSshHost, setSshHost, isLocalMachine, setServerHostTargets } from "./workspace";
import {
  ensureTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  killAllTerminals,
  type EnsureArgs,
} from "./terminal";
import {
  startForward,
  stopForward,
  listForwards,
  stopAllForwards,
  type StartArgs as ForwardStartArgs,
} from "./forwarding";
import { sshSetup, type SshSetupArgs } from "./ssh-setup";
import { listDir, readFileAt, writeFileAt, deletePath, makeDir, createFile, uploadLocalFile } from "./files";
import { gitInfo } from "./git";
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
      // Enable the <webview> tag for the Browser tab's Chromium preview.
      webviewTag: true,
    },
  });

  // Enforce vibrancy at runtime too — the constructor option is a no-op on some
  // macOS/Electron combos, but setVibrancy after creation reliably applies it.
  if (process.platform === "darwin") win.setVibrancy("under-window");

  win.on("ready-to-show", () => win.show());

  // Links in the chat/markdown must NOT navigate the app away. Open http(s) links
  // to a different origin in the user's real browser; deny popups likewise.
  const appOrigin = (): string => {
    try { return new URL(win.webContents.getURL()).origin; } catch { return ""; }
  };
  win.webContents.on("will-navigate", (e, url) => {
    if (/^https?:/i.test(url)) {
      try { if (new URL(url).origin === appOrigin()) return; } catch { /* treat as external */ }
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(here, "../renderer/index.html"));
  }
}

let stopStream: (() => void) | null = null;
let hostTargetsTimer: NodeJS.Timeout | null = null;

/**
 * Pull each host's agent-reported reachable address from cowork and feed it to the
 * SSH resolver, so remote terminal/files/git/browser "just work" without the user
 * configuring an SSH host per machine. Refreshed periodically; failures are ignored.
 */
async function refreshHostTargets(): Promise<void> {
  try {
    const hosts = await api.getHosts();
    const map: Record<string, string> = {};
    for (const h of hosts) {
      if (h.address) map[h.machine] = h.user ? `${h.user}@${h.address}` : h.address;
    }
    setServerHostTargets(map);
  } catch {
    // not configured / offline — keep whatever we had
  }
}

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
    // Auto-discover SSH targets now and every 60s.
    refreshHostTargets();
    if (hostTargetsTimer) clearInterval(hostTargetsTimer);
    hostTargetsTimer = setInterval(() => { refreshHostTargets().catch(() => {}); }, 60_000);
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
ipcMain.handle(IPC.authConfig, (_e, a: { serverUrl: string }) => api.authConfig(a.serverUrl));
ipcMain.handle(IPC.redstoneLogin, async (_e, a: { serverUrl: string; username: string; password: string }) => {
  try {
    const { access_token, refresh_token } = await api.redstoneLogin(a.serverUrl, a.username, a.password);
    saveConfig(a.serverUrl, access_token, refresh_token ?? undefined);
    startForwarding();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

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
ipcMain.handle(IPC.interrupt, (_e, a: { sessionId: string; text?: string }) =>
  api.interrupt(a.sessionId, a.text)
);
ipcMain.handle(IPC.mode, (_e, a: { sessionId: string; mode: string }) =>
  api.switchMode(a.sessionId, a.mode)
);
ipcMain.handle(IPC.userTodoAdd, (_e, a: { sessionId: string; text: string }) =>
  api.addUserTodo(a.sessionId, a.text)
);
ipcMain.handle(IPC.userTodoToggle, (_e, a: { sessionId: string; todoId: string }) =>
  api.toggleUserTodo(a.sessionId, a.todoId)
);
ipcMain.handle(IPC.userTodoDelete, (_e, a: { sessionId: string; todoId: string }) =>
  api.deleteUserTodo(a.sessionId, a.todoId)
);
ipcMain.handle(IPC.tagAdd, (_e, a: { sessionId: string; tag: string }) =>
  api.addTag(a.sessionId, a.tag)
);
ipcMain.handle(IPC.tagRemove, (_e, a: { sessionId: string; tag: string }) =>
  api.removeTag(a.sessionId, a.tag)
);
ipcMain.handle(IPC.inventoryList, () => api.getInventory());
ipcMain.handle(IPC.dockerList, () => api.getDocker());
ipcMain.handle(IPC.capsList, () => api.getCaps());
ipcMain.handle(IPC.gitInfo, (_e, a: { cwd: string; machine: string }) => gitInfo(a.cwd, a.machine));
ipcMain.handle(IPC.telemetryList, () => api.getTelemetry());
ipcMain.handle(IPC.inventoryHistory, (_e, a: { id: string }) => api.inventoryHistory(a.id));
ipcMain.handle(IPC.inventoryRun, (_e, a: { id: string; message: string }) => api.inventoryRun(a.id, a.message));
ipcMain.handle(IPC.inventoryTagAdd, (_e, a: { id: string; tag: string }) => api.inventoryAddTag(a.id, a.tag));
ipcMain.handle(IPC.inventoryTagRemove, (_e, a: { id: string; tag: string }) => api.inventoryRemoveTag(a.id, a.tag));
ipcMain.handle(IPC.accessKeysList, () => api.listAccessKeys());
ipcMain.handle(IPC.accessKeyCreate, (_e, a: { name: string; scope: "read" | "control" }) => api.createAccessKey(a.name, a.scope));
ipcMain.handle(IPC.accessKeyRevoke, (_e, a: { id: string }) => api.revokeAccessKey(a.id));

// Workspace config (per-session .redstone/session.json)
ipcMain.handle(IPC.workspaceGet, (_e, a: Parameters<typeof getWorkspaceConfig>[0]) =>
  getWorkspaceConfig(a)
);
ipcMain.handle(IPC.workspaceSave, (_e, a: Parameters<typeof saveWorkspaceConfig>[0]) =>
  saveWorkspaceConfig(a)
);

// Per-machine SSH host (userData/ssh-hosts.json) — main never throws across IPC.
ipcMain.handle(IPC.workspaceGetSshHost, (_e, a: { machine: string }) => {
  try {
    return getSshHost(a.machine);
  } catch {
    return a.machine;
  }
});
ipcMain.handle(IPC.workspaceSetSshHost, (_e, a: { machine: string; host: string }) => {
  try {
    setSshHost(a.machine, a.host);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle(IPC.workspaceIsLocal, (_e, a: { machine: string }) => {
  try {
    return isLocalMachine(a.machine);
  } catch {
    return false;
  }
});

// Passwordless SSH onboarding — main never throws; sshSetup returns a result object.
ipcMain.handle(IPC.sshSetup, (_e, a: SshSetupArgs) => sshSetup(a));

// Latest agent-reported SSH result for a session (null when none) — main never throws.
ipcMain.handle(IPC.sshResultGet, async (_e, sessionId: string) => {
  try {
    return await api.getSshResult(sessionId);
  } catch {
    return null;
  }
});

// Terminal (PTY) IPC — main never throws across these channels.
ipcMain.handle(IPC.terminalStart, (e, a: EnsureArgs) => {
  const wc = e.sender;
  const result = ensureTerminal(
    a,
    (data) => {
      if (!wc.isDestroyed()) wc.send(IPC.terminalData, { id: a.id, data });
    },
    () => {
      if (!wc.isDestroyed()) wc.send(IPC.terminalExit, { id: a.id });
    }
  );
  return result;
});
ipcMain.on(IPC.terminalInput, (_e, a: { id: string; data: string }) =>
  writeTerminal(a.id, a.data)
);
ipcMain.on(IPC.terminalResize, (_e, a: { id: string; cols: number; rows: number }) =>
  resizeTerminal(a.id, a.cols, a.rows)
);
ipcMain.handle(IPC.terminalKill, (_e, a: { id: string }) => {
  killTerminal(a.id);
  return { ok: true };
});

// Port forwarding (ssh -N -L) IPC — main never throws across these channels.
ipcMain.handle(IPC.forwardStart, (e, a: ForwardStartArgs) => {
  const wc = e.sender;
  try {
    startForward(a, (port, status, error) => {
      if (!wc.isDestroyed())
        wc.send(IPC.forwardStatus, { sessionId: a.sessionId, port, status, error });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle(IPC.forwardStop, (_e, a: { sessionId: string; port: number }) => {
  stopForward(a.sessionId, a.port);
  return { ok: true };
});
ipcMain.handle(IPC.forwardList, (_e, a: { sessionId: string }) => listForwards(a.sessionId));

// LLM assistant — proxied through the cowork server (keys live server-side).
ipcMain.handle(IPC.llmModels, () => api.llmModels());
ipcMain.handle(IPC.llmAssist, (_e, a: Parameters<typeof api.llmAssist>[0]) => api.llmAssist(a));
ipcMain.handle(IPC.llmAddEndpoint, (_e, a: Parameters<typeof api.addLlmEndpoint>[0]) => api.addLlmEndpoint(a));
ipcMain.handle(IPC.llmDeleteEndpoint, (_e, a: { id: string }) => api.deleteLlmEndpoint(a.id));
ipcMain.handle(IPC.llmAgent, (_e, a: Parameters<typeof api.llmAgent>[0]) => api.llmAgent(a));
ipcMain.handle(IPC.llmAgentEnabled, () => api.agentEnabled());

// Open a URL in the user's real browser.
ipcMain.handle(IPC.openExternal, (_e, a: { url: string }) => {
  try {
    if (a.url && /^https?:\/\//i.test(a.url)) shell.openExternal(a.url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// File browser — list / read / write, local or over ssh. Main never throws across IPC.
ipcMain.handle(IPC.filesList, (_e, a: { cwd: string; machine: string; dir: string }) =>
  listDir(a)
);
ipcMain.handle(IPC.filesRead, (_e, a: { cwd: string; machine: string; file: string }) =>
  readFileAt(a)
);
ipcMain.handle(IPC.filesWrite, (_e, a: { cwd: string; machine: string; file: string; content: string }) =>
  writeFileAt(a)
);
ipcMain.handle(IPC.filesDelete, (_e, a: { cwd: string; machine: string; path: string }) =>
  deletePath(a)
);
ipcMain.handle(IPC.filesMkdir, (_e, a: { cwd: string; machine: string; parent: string; name: string }) =>
  makeDir(a)
);
ipcMain.handle(IPC.filesCreate, (_e, a: { cwd: string; machine: string; parent: string; name: string }) =>
  createFile(a)
);
// Upload: open the OS file picker, then copy each chosen file into destDir.
ipcMain.handle(IPC.filesUpload, async (e, a: { cwd: string; machine: string; destDir: string }) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const picked = await dialog.showOpenDialog(win!, {
      title: "Upload file(s)",
      properties: ["openFile", "multiSelections"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, uploaded: 0 };
    let uploaded = 0;
    const errors: string[] = [];
    for (const srcPath of picked.filePaths) {
      const r = await uploadLocalFile({ cwd: a.cwd, machine: a.machine, srcPath, destDir: a.destDir });
      if (r.ok) uploaded++;
      else errors.push(r.error ?? "failed");
    }
    return { ok: errors.length === 0, uploaded, error: errors[0] };
  } catch (err) {
    return { ok: false, uploaded: 0, error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle(IPC.clipboardWrite, (_e, a: { text: string }) => {
  try {
    clipboard.writeText(a.text ?? "");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

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
  killAllTerminals();
  stopAllForwards();
});
