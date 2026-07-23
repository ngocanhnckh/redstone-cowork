import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell, dialog, clipboard, protocol, net, desktopCapturer, session, webContents as webContentsModule, type Session } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename, extname, normalize, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { saveConfig, loadConfig, clearConfig } from "./config";
import * as api from "./api";
import { getWorkspaceConfig, saveWorkspaceConfig, getSshHost, setSshHost, isLocalMachine, setServerHosts, warmSshMaster } from "./workspace";
import { getHostIps, getHostConnections, getHostProcesses } from "./host-info";
import { getCalendarEvents } from "./calendar";
import { requestCalendarPermission } from "./calendar-permission";
import { getNetworkMap } from "./network";
import { getWeather } from "./weather";
import {
  ensureTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  killAllTerminals,
  type EnsureArgs,
} from "./terminal";
import {
  ensureDockerLog,
  stopDockerLog,
  killAllDockerLogs,
  type DockerLogArgs,
} from "./docker-logs";
import {
  startForward,
  stopForward,
  listForwards,
  stopAllForwards,
  type StartArgs as ForwardStartArgs,
} from "./forwarding";
import { sshSetup, type SshSetupArgs } from "./ssh-setup";
import { listDir, readFileAt, writeFileAt, writeFileBase64, deletePath, makeDir, createFile, uploadLocalFile, searchFiles, searchFilesStream, downloadFileTo } from "./files";
import { gitInfo } from "./git";
import { chooseBgImage, getBgImage, clearBgImage, setSimpleFullscreen, isFullscreen, loadFullscreenPref, setVibrancy, chooseBgVideo, getBgVideoUrl, clearBgVideo, currentBgVideoPath } from "./appearance";
import { registerSessionBrowser, unregisterSessionBrowser, startInspect, stopInspect, stopAllInspectors, getResponseBody } from "./devtools";
import { loadEnabledExtensions, listExtensions, chooseAndAddExtension, installFromWebStore, setExtensionEnabled, removeExtension, browserSession } from "./browser-extensions";
import { vaultAvailable, listCredentials, getCredentialForOrigin, saveCredential, deleteCredential } from "./browser-vault";
import { IPC } from "../shared/ipc";

const here = dirname(fileURLToPath(import.meta.url));

// Custom privileged schemes — must be registered BEFORE the app is ready.
//  · rcw-media — streams the user's background video with range support.
//  · app       — serves the packaged renderer from a FIXED origin (app://bundle/…)
//    instead of file://. This is what makes localStorage durable: the unsigned mac
//    app runs from a randomized App-Translocation path each launch, so a file://
//    origin (whose storage Chromium keys per-path/opaque) kept "forgetting" the
//    saved layout, Jira settings and token. A standard+secure custom scheme has a
//    constant origin regardless of where the .app is mounted, so web storage sticks.
protocol.registerSchemesAsPrivileged([
  { scheme: "rcw-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------------------------------------------------------------------------
// Tray state
// ---------------------------------------------------------------------------
let tray: Tray | null = null;
let waitingIds = new Set<string>();
let trayRefreshRunning = false;
// Per-session last seen final answer, so we notify once when a NEW answer lands.
const lastAnswers = new Map<string, string>();
let answersInit = false;

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

    // Notify when ANY session produces a NEW final answer. This is independent of
    // the waiting queue — it fires for sessions that just finished a turn with an
    // answer. We notify even when the app is focused, because the whole point is to
    // catch another session finishing while you're looking at a different one. The
    // first poll seeds silently so there's no burst on launch.
    try {
      const sessions = (await api.getSessions()) as Array<{
        id: string; cwd: string; latestAnswer: string | null;
      }>;
      const firstRun = !answersInit;
      for (const s of sessions) {
        const ans = (s.latestAnswer ?? "").trim();
        if (!ans || lastAnswers.get(s.id) === ans) continue;
        lastAnswers.set(s.id, ans);
        if (firstRun || !Notification.isSupported()) continue;
        const repoName = basename(s.cwd || "session");
        const body = `${repoName} — ${ans.replace(/\s+/g, " ").slice(0, 140)}`;
        try {
          const n = new Notification({ title: "Claude answered", body });
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
      // Drop answers for sessions that no longer exist so the map can't grow forever.
      const live = new Set(sessions.map((s) => s.id));
      for (const id of [...lastAnswers.keys()]) if (!live.has(id)) lastAnswers.delete(id);
      answersInit = true;
    } catch {
      // best-effort
    }
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
    // ▓▓ WALLPAPER KNOB ▓▓ — `vibrancy` controls the blurred desktop material.
    //   • Everyday tint density is the `--app-veil` CSS var (renderer globals.css).
    //   • For a LIGHTER blur try "sidebar" / "hud"; to remove the app's own tint
    //     and show the RAW, un-blurred wallpaper, drop `vibrancy`, set
    //     `transparent: true` here, and lower `--app-veil` toward 0%.
    vibrancy: "under-window",
    visualEffectState: "active",
    // Transparent-capable so that when vibrancy is dropped (Appearance › "Transparent
    // app in HUD mode") the RAW desktop shows through instead of an opaque backing.
    // (This is INNOCENT of the fullscreen-blank bug — it predates it; the real cause
    // was backgroundThrottling, see webPreferences below.)
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(here, "../preload/index.mjs"),
      // sandbox: false required — preload uses contextBridge + ipcRenderer which need Node/Electron access
      sandbox: false,
      // Enable the <webview> tag for the Browser tab's Chromium preview.
      webviewTag: true,
      // Allow the looping background video to autoplay WITH sound (no gesture).
      autoplayPolicy: "no-user-gesture-required",
      // NOTE: do NOT set `backgroundThrottling: false`. macOS marks the fullscreen
      // window "occluded"; forcing the renderer to keep painting into that occluded
      // surface produced a BLANK UI in fullscreen. Default throttling keeps the last
      // frame instead. The background video's own pause/visibility auto-resume
      // (BgVideo.tsx) keeps it playing without needing to disable throttling.
    },
  });

  // Enforce vibrancy at runtime too — the constructor option is a no-op on some
  // macOS/Electron combos, but setVibrancy after creation reliably applies it.
  if (process.platform === "darwin") win.setVibrancy("under-window");

  win.on("ready-to-show", () => {
    // Reopen the way it was last left: if the app was in (keep-wallpaper) fullscreen,
    // restore it before showing so it doesn't flash windowed first.
    if (loadFullscreenPref()) { try { setSimpleFullscreen(win, true); } catch { /* ignore */ } }
    win.show();
  });

  // This is the cockpit window that runs the shortcut dispatcher; capture its keys at
  // the input layer so shortcuts fire no matter which panel/editor has focus.
  const wc = win.webContents;
  mainWinWC = wc;
  wc.on("before-input-event", forwardShortcut);
  win.on("closed", () => { if (mainWinWC === wc) mainWinWC = null; });

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

  // Right-click on a link in the chat/markdown → let the user choose where it
  // opens. Left-click routes to the in-app workspace browser (renderer handles
  // it); this menu is the "unless I right-click" escape hatch to the OS browser.
  win.webContents.on("context-menu", (_e, params) => {
    if (!params.linkURL) return;
    Menu.buildFromTemplate([
      { label: "Open in Workspace Browser", click: () => openInWorkspaceBrowser(params.linkURL) },
      { label: "Open in Real Browser", click: () => shell.openExternal(params.linkURL).catch(() => {}) },
      { type: "separator" },
      { label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) },
    ]).popup();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Load from the fixed app:// origin (see registerSchemesAsPrivileged) — NOT
    // file:// — so localStorage persists across launches / app-translocation.
    win.loadURL("app://bundle/index.html");
  }
}

// Pop-out terminal windows — each is a small standalone OS window that renders ONLY
// a terminal (the renderer routes on the `#term=` hash), with its own independent
// PTY (unique id), on the session's host/cwd. Tracked so they close cleanly.
let termWinSeq = 0;
const termWindows = new Set<BrowserWindow>();
function openTerminalWindow(a: { sessionId: string; cwd: string; machine: string; title?: string }): void {
  const ptyId = `${a.sessionId || "term"}::win::${++termWinSeq}`;
  const win = new BrowserWindow({
    width: 900,
    height: 560,
    minWidth: 420,
    minHeight: 240,
    show: false,
    title: a.title || "Terminal",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    vibrancy: "under-window",
    visualEffectState: "active",
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(here, "../preload/index.mjs"),
      sandbox: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (process.platform === "darwin") win.setVibrancy("under-window");
  win.webContents.on("before-input-event", forwardShortcut);
  win.on("ready-to-show", () => win.show());
  termWindows.add(win);
  win.on("closed", () => {
    termWindows.delete(win);
    // Reap the pop-out's PTY so its shell doesn't linger after the window is gone.
    killTerminal(ptyId);
  });

  const hash = "#term=" + encodeURIComponent(JSON.stringify({ ...a, ptyId }));
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + hash);
  } else {
    win.loadURL("app://bundle/index.html" + hash);
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
    // Feed the full records (incl. hostId + sshPort) so the SSH resolver can both
    // auto-discover direct addresses AND look up a relay tunnel for NAT'd hosts.
    setServerHosts(hosts);
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
    }, () => BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.isMinimized()));
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
ipcMain.handle(IPC.accountLogin, async (_e, a: { serverUrl: string; username: string; password: string }) => {
  try {
    const device = `${hostname()} · ${process.platform} · Redstone Cowork ${app.getVersion()}`;
    const { token, account } = await api.accountLogin(a.serverUrl, a.username, a.password, device);
    // The rcwa_ bearer rides the same config slot as the instance token — every
    // existing request path just works, and the API guard scopes it per-account.
    saveConfig(a.serverUrl, token);
    startForwarding();
    return { ok: true, account };
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
ipcMain.handle(IPC.dismiss, (_e, a: { id: string }) =>
  api.dismissSession(a.id)
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
ipcMain.handle(IPC.claudeConfigsList, () => api.listClaudeConfigs());
ipcMain.handle(IPC.claudeConfigGet, (_e, a: { name: string }) => api.getClaudeConfig(a.name));
ipcMain.handle(IPC.claudeConfigPut, (_e, a: { name: string; env: Record<string, string> }) => api.putClaudeConfig(a.name, a.env));
ipcMain.handle(IPC.claudeConfigDelete, (_e, a: { name: string }) => api.deleteClaudeConfig(a.name));
ipcMain.handle(IPC.jiraProfilesList, () => api.jiraProfilesList());
ipcMain.handle(IPC.jiraProfilePut, (_e, a: { name: string; baseUrl: string; pat: string }) => api.jiraProfilePut(a.name, a.baseUrl, a.pat));
ipcMain.handle(IPC.jiraProfileDelete, (_e, a: { name: string }) => api.jiraProfileDelete(a.name));
ipcMain.handle(IPC.jiraProfileValidate, (_e, a: { name: string }) => api.jiraProfileValidate(a.name));
ipcMain.handle(IPC.jiraGetBinding, (_e, a: { sessionId: string }) => api.jiraGetBinding(a.sessionId));
ipcMain.handle(IPC.jiraSetBinding, (_e, a: { sessionId: string; binding: { profile: string; projectKey: string; boardId?: number | null } }) => api.jiraSetBinding(a.sessionId, a.binding));
ipcMain.handle(IPC.jiraClearBinding, (_e, a: { sessionId: string }) => api.jiraClearBinding(a.sessionId));
ipcMain.handle(IPC.jiraSessionIssues, (_e, a: { sessionId: string }) => api.jiraSessionIssues(a.sessionId));
ipcMain.handle(IPC.jiraIssueDetail, (_e, a: { sessionId: string; key: string }) => api.jiraIssueDetail(a.sessionId, a.key));
ipcMain.handle(IPC.jiraCreateIssue, (_e, a: { sessionId: string; summary: string }) => api.jiraCreateIssue(a.sessionId, a.summary));
ipcMain.handle(IPC.jiraUpdateIssue, (_e, a: { sessionId: string; key: string; fields: { summary?: string; description?: string } }) => api.jiraUpdateIssue(a.sessionId, a.key, a.fields));
ipcMain.handle(IPC.jiraCreateSubtask, (_e, a: { sessionId: string; key: string; summary: string; description?: string }) => api.jiraCreateSubtask(a.sessionId, a.key, a.summary, a.description));
ipcMain.handle(IPC.jiraIssueTransitions, (_e, a: { sessionId: string; key: string }) => api.jiraIssueTransitions(a.sessionId, a.key));
ipcMain.handle(IPC.jiraTransitionIssue, (_e, a: { sessionId: string; key: string; transitionId: string }) => api.jiraTransitionIssue(a.sessionId, a.key, a.transitionId));

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
ipcMain.handle(IPC.hostIps, (_e, a: { machine: string }) => getHostIps(a.machine));
ipcMain.handle(IPC.hostConnections, (_e, a: { machine: string }) => getHostConnections(a.machine));
ipcMain.handle(IPC.hostProcesses, (_e, a: { machine: string }) => getHostProcesses(a.machine));
ipcMain.handle(IPC.calendarEvents, () => getCalendarEvents());
ipcMain.handle(IPC.networkMap, (_e, a: { machine: string }) => getNetworkMap(a.machine));
ipcMain.handle(IPC.weather, () => getWeather());
// Warm the SSH master for a remote host when its file/terminal UI opens, so the
// first file read doesn't pay the (relay-amplified) connection handshake.
ipcMain.handle(IPC.warmHost, (_e, a: { machine: string }) => { warmSshMaster(a.machine); return { ok: true }; });

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
ipcMain.handle(IPC.terminalWindowOpen, (_e, a: { sessionId: string; cwd: string; machine: string; title?: string }) => {
  openTerminalWindow(a);
  return { ok: true };
});

// Docker log streaming IPC — main never throws across these channels.
ipcMain.handle(IPC.dockerLogStart, (e, a: DockerLogArgs) => {
  const wc = e.sender;
  return ensureDockerLog(
    a,
    (data) => {
      if (!wc.isDestroyed()) wc.send(IPC.dockerLogData, { id: a.id, data });
    },
    () => {
      if (!wc.isDestroyed()) wc.send(IPC.dockerLogExit, { id: a.id });
    }
  );
});
ipcMain.handle(IPC.dockerLogStop, (_e, a: { id: string }) => {
  stopDockerLog(a.id);
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
ipcMain.handle(IPC.llmChat, (_e, a: Parameters<typeof api.llmChat>[0]) => api.llmChat(a));
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

// Custom-app <webview> guests register their home URL here (keyed by the guest's
// webContents id). The web-contents-created hook consults this map to keep the
// mini-app pinned to its own domain: a click/popup leaving the app's site pops
// out to the real browser instead of navigating the app away. Browser-tab guests
// are never registered, so they keep full free navigation.
const appGuestHomes = new Map<number, string>();

/** The registrable-ish base domain (last two labels) of a hostname, lowercased. */
function baseDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  return (labels.length <= 2 ? labels : labels.slice(-2)).join(".").toLowerCase();
}
/** True when two URLs belong to the same site (same base domain), so subdomains
 * of the app (e.g. an SSO/login host) still navigate in place. */
function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname;
    const hb = new URL(b).hostname;
    return !!ha && !!hb && baseDomain(ha) === baseDomain(hb);
  } catch {
    return false;
  }
}

/** Ask the renderer to open a URL in the focused session's in-app workspace
 * browser (our browser, never the OS default). Used when a custom app tries to
 * leave its own domain. */
function openInWorkspaceBrowser(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.openInWorkspaceBrowser, { url });
}

/** Parse a window.open() features string ("width=500,height=600,left=…") into a
 * subset of BrowserWindow sizing options, so a genuine popup (OAuth/login/pay
 * window) opens at roughly the size the site asked for. Missing → sensible default. */
function popupWindowOptions(features: string): { width: number; height: number } {
  const get = (k: string): number | undefined => {
    const m = new RegExp(`(?:^|[ ,])${k}\\s*=\\s*(\\d+)`, "i").exec(features || "");
    return m ? Number(m[1]) : undefined;
  };
  const clamp = (n: number | undefined, def: number) => Math.min(1600, Math.max(320, n ?? def));
  return { width: clamp(get("width") ?? get("innerWidth"), 520), height: clamp(get("height") ?? get("innerHeight"), 640) };
}

ipcMain.handle(IPC.appGuestRegister, (_e, a: { webContentsId: number; homeUrl: string }) => {
  if (typeof a?.webContentsId === "number" && a.homeUrl) appGuestHomes.set(a.webContentsId, a.homeUrl);
  return { ok: true };
});
ipcMain.handle(IPC.appGuestUnregister, (_e, a: { webContentsId: number }) => {
  if (typeof a?.webContentsId === "number") appGuestHomes.delete(a.webContentsId);
  return { ok: true };
});

// Make a themed custom-app guest composite TRANSPARENTLY so the cockpit's glass panel
// shows through its (CSS-transparent) page. Off → back to an opaque white base.
ipcMain.handle(IPC.appSetTransparent, (_e, a: { webContentsId: number; on: boolean }) => {
  try {
    const wc = typeof a?.webContentsId === "number" ? webContentsModule.fromId(a.webContentsId) : null;
    // setBackgroundColor exists on WebContents at runtime (Electron ≥22) but isn't in
    // the current type defs — cast to reach it.
    (wc as unknown as { setBackgroundColor?: (c: string) => void } | null)?.setBackgroundColor?.(a.on ? "#00000000" : "#ffffff");
  } catch { /* guest gone */ }
  return { ok: true };
});

// Inject the theme stylesheet into EVERY frame of a custom-app guest — not just the top
// document (which webview.insertCSS covers) but nested iframes too (e.g. Jira plugin
// panels like BigPicture), which are often cross-origin and can only be scripted from
// main. Re-injects on each frame load so late/async iframes get themed as well.
const themeCssByGuest = new Map<number, string>();
const themeWiredGuests = new WeakSet<object>();
function frameInjectorJs(css: string): string {
  return `(function(c){try{var i='__rcw_theme__';var e=document.getElementById(i);`
    + `if(!c){if(e)e.remove();return;}`
    + `if(!e){e=document.createElement('style');e.id=i;(document.head||document.documentElement).appendChild(e);}`
    + `e.textContent=c;}catch(_){}})(${JSON.stringify(css)});`;
}
function injectThemeAllFrames(wc: Electron.WebContents): void {
  const css = themeCssByGuest.get(wc.id) ?? "";
  const js = frameInjectorJs(css);
  try {
    for (const f of wc.mainFrame.framesInSubtree) {
      f.executeJavaScript(js, true).catch(() => {});
    }
  } catch { /* frame tree gone */ }
}
ipcMain.handle(IPC.appInjectCss, (_e, a: { webContentsId: number; css: string }) => {
  const wc = typeof a?.webContentsId === "number" ? webContentsModule.fromId(a.webContentsId) : null;
  if (!wc) return { ok: false };
  themeCssByGuest.set(a.webContentsId, a.css ?? "");
  if (!themeWiredGuests.has(wc)) {
    themeWiredGuests.add(wc);
    wc.on("did-frame-finish-load", () => injectThemeAllFrames(wc)); // catches late iframes
    wc.once("destroyed", () => themeCssByGuest.delete(a.webContentsId));
  }
  injectThemeAllFrames(wc);
  return { ok: true };
});

// Appearance: custom background image + macOS "keep wallpaper in fullscreen".
const senderWindow = (e: Electron.IpcMainInvokeEvent): BrowserWindow | undefined =>
  BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getAllWindows()[0] ?? undefined;
ipcMain.handle(IPC.bgImageChoose, (e) => chooseBgImage(senderWindow(e)));
ipcMain.handle(IPC.bgImageGet, () => getBgImage());
ipcMain.handle(IPC.bgImageClear, async () => { await clearBgImage(); return { ok: true }; });
ipcMain.handle(IPC.simpleFullscreen, (e, a: { on: boolean }) => ({ fullscreen: setSimpleFullscreen(senderWindow(e), !!a?.on) }));
ipcMain.handle(IPC.fullscreenState, (e) => ({ fullscreen: isFullscreen(senderWindow(e)) }));
ipcMain.handle(IPC.setVibrancy, (e, a: { on: boolean }) => { setVibrancy(senderWindow(e), !!a?.on); return { ok: true }; });
ipcMain.handle(IPC.bgVideoChoose, (e) => chooseBgVideo(senderWindow(e)));
ipcMain.handle(IPC.bgVideoGet, () => getBgVideoUrl());
ipcMain.handle(IPC.bgVideoClear, async () => { await clearBgVideo(); return { ok: true }; });

// Browser inspector (console + network) wiring.
ipcMain.handle(IPC.sessionBrowserRegister, (_e, a: { sessionId: string; webContentsId: number }) => {
  if (a?.sessionId && typeof a.webContentsId === "number") registerSessionBrowser(a.sessionId, a.webContentsId);
  return { ok: true };
});
ipcMain.handle(IPC.sessionBrowserUnregister, (_e, a: { sessionId: string; webContentsId?: number }) => {
  if (a?.sessionId) unregisterSessionBrowser(a.sessionId, typeof a.webContentsId === "number" ? a.webContentsId : undefined);
  return { ok: true };
});
ipcMain.handle(IPC.devtoolsStart, (_e, a: { sessionId: string }) => (a?.sessionId ? startInspect(a.sessionId) : { ok: false }));
ipcMain.handle(IPC.devtoolsStop, (_e, a: { sessionId: string }) => { if (a?.sessionId) stopInspect(a.sessionId); return { ok: true }; });
ipcMain.handle(IPC.devtoolsBody, (_e, a: { sessionId: string; requestId: string }) => (a?.sessionId && a?.requestId ? getResponseBody(a.sessionId, a.requestId) : null));

// Chrome-extension management for the shared browser session (partition-wide).
ipcMain.handle(IPC.extensionsList, () => listExtensions());
ipcMain.handle(IPC.extensionAdd, () => chooseAndAddExtension());
ipcMain.handle(IPC.extensionInstallWebStore, (_e, a: { idOrUrl: string }) => installFromWebStore(a.idOrUrl));

// Screen-share source picker: the renderer resolves the pending getDisplayMedia
// request with the user's chosen source (or null to cancel).
// ---- Keyboard shortcut capture (before-input-event) ----------------------------
// App shortcuts must fire wherever focus is — a text input, the Monaco editor, the
// xterm terminal, or inside a <webview> page. DOM keydown doesn't reliably bubble out
// of all of those, so we intercept at Chromium's input layer (before-input-event) on
// BOTH the main window and every guest, and forward the key to the cockpit renderer's
// dispatcher (see useKeybindings). Combos that the user has actually BOUND are also
// preventDefault'd here so they don't leak into the focused element (e.g. Ctrl+Tab
// won't move focus). `boundAccels` is synced from the renderer.
let mainWinWC: import("electron").WebContents | null = null;
let boundAccels = new Set<string>();
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "CapsLock"]);
function accelOf(input: Electron.Input): string | null {
  if (MODIFIER_KEYS.has(input.key)) return null;
  const parts: string[] = [];
  if (input.control) parts.push("Ctrl");
  if (input.alt) parts.push("Alt");
  if (input.shift) parts.push("Shift");
  if (input.meta) parts.push("Meta");
  let key = input.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}
function forwardShortcut(event: Electron.Event, input: Electron.Input): void {
  if (!mainWinWC || mainWinWC.isDestroyed()) return;
  if (input.type === "keyUp") {
    // Only modifier releases matter (they commit the hold-to-switch overlay).
    if (input.key === "Control" || input.key === "Meta" || input.key === "Alt")
      mainWinWC.send(IPC.guestKey, { type: "keyUp", key: input.key, ctrl: false, meta: false, alt: false, shift: false });
    return;
  }
  const combo = input.control || input.meta || input.alt;
  if (combo) {
    const accel = accelOf(input);
    if (accel && boundAccels.has(accel)) event.preventDefault(); // owned shortcut → don't leak to the focused element
    mainWinWC.send(IPC.guestKey, { type: "keyDown", key: input.key, ctrl: !!input.control, meta: !!input.meta, alt: !!input.alt, shift: !!input.shift });
  } else if (input.key === "Escape") {
    mainWinWC.send(IPC.guestKey, { type: "keyDown", key: "Escape", ctrl: false, meta: false, alt: false, shift: false });
  }
}
ipcMain.handle(IPC.keybindingsSync, (_e, a: { accels: string[] }) => { boundAccels = new Set(a?.accels ?? []); return { ok: true }; });

// Pull keyboard focus to the host window content (away from any focused <webview>
// or terminal guest). The session switcher calls this on open so the modifier
// keyUp that commits it actually reaches the renderer — a guest swallows keyUp,
// which is what made the switcher hang until its fallback timer fired.
ipcMain.on(IPC.focusMainWindow, () => { try { mainWinWC?.focus(); } catch { /* window gone */ } });

let displayPickResolver: ((c: { kind: string; id: string } | null) => void) | null = null;
ipcMain.handle(IPC.displayMediaPick, (_e, a: { kind: string; id: string }) => { displayPickResolver?.(a); return { ok: true }; });
ipcMain.handle(IPC.displayMediaCancel, () => { displayPickResolver?.(null); return { ok: true }; });

// Grant the browser permissions (camera/mic/screen-share/clipboard/fullscreen) and
// wire the custom screen-share source picker on a session. Applied to the shared
// persistent profile AND to each temp/incognito partition (via prepareBrowserPartition)
// so incognito tabs can log in, use media, and screen-share just like normal tabs.
/** A minimal self-contained browser shell (address bar + back/forward/reload + a
 * <webview>) for the pop-out "Open in new window". No template placeholders that
 * could break on quotes: the partition is attribute-safe and the start URL is
 * injected as a JSON literal. Regex is avoided in the inline script to dodge
 * template-escaping pitfalls. */
function browserWindowHtml(partition: string, startUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Redstone Browser</title><style>
    html,body{margin:0;height:100%;background:#15110d;color:#f0ece1;font-family:ui-monospace,Menlo,monospace;overflow:hidden}
    #bar{display:flex;gap:6px;align-items:center;padding:8px 10px;height:28px;border-bottom:1px solid #3a3228;box-sizing:border-box}
    #bar button{background:transparent;border:1px solid #3a3228;color:#cfc6b6;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:13px;line-height:1}
    #addr{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid #3a3228;color:#f0ece1;border-radius:8px;padding:6px 11px;outline:none;font-size:12px}
    webview{position:absolute;left:0;right:0;top:45px;bottom:0;width:100%}
  </style></head><body>
    <div id="bar">
      <button id="back" title="Back">&#9664;</button>
      <button id="fwd" title="Forward">&#9654;</button>
      <button id="rl" title="Reload">&#8635;</button>
      <input id="addr" placeholder="Search or type a URL" spellcheck="false"/>
    </div>
    <webview id="wv" partition="${partition}" allowpopups></webview>
    <script>
      var wv=document.getElementById('wv'), addr=document.getElementById('addr');
      var START=${JSON.stringify(startUrl)};
      function norm(s){s=(s||'').trim(); if(!s)return ''; if(s.indexOf('://')>0)return s;
        var local=/^(localhost|127\\.|10\\.|192\\.168\\.)/.test(s);
        if(s.indexOf(' ')<0 && s.indexOf('.')>0)return (local?'http://':'https://')+s;
        if(local)return 'http://'+s;
        return 'https://www.google.com/search?q='+encodeURIComponent(s);}
      addr.addEventListener('keydown',function(e){if(e.key==='Enter'){var u=norm(addr.value); if(u)wv.loadURL(u);}});
      document.getElementById('back').onclick=function(){if(wv.canGoBack())wv.goBack();};
      document.getElementById('fwd').onclick=function(){if(wv.canGoForward())wv.goForward();};
      document.getElementById('rl').onclick=function(){wv.reload();};
      function sync(e){if(e&&e.url)addr.value=e.url;}
      wv.addEventListener('did-navigate',sync);
      wv.addEventListener('did-navigate-in-page',sync);
      wv.addEventListener('page-title-updated',function(e){document.title=e.title||'Redstone Browser';});
      wv.src=START; addr.value=(START==='about:blank'?'':START);
    </script>
  </body></html>`;
}

const preppedPartitions = new Set<string>();
function applyBrowserPerms(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(["media", "display-capture", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock"].includes(permission)),
  );
  ses.setPermissionCheckHandler(() => true);
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 400, height: 240 } });
      const srcMap = new Map(sources.map((s) => [s.id, s]));
      const screens = sources.map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith("screen:") ? "screen" : "window", thumb: s.thumbnail.toDataURL() }));
      const tabs = webContentsModule.getAllWebContents()
        .filter((wc) => wc.getType() === "webview" && !wc.isDestroyed() && (wc.getURL() || "").startsWith("http"))
        .map((wc) => ({ id: String(wc.id), title: (wc.getTitle() || wc.getURL() || "tab").slice(0, 90), url: wc.getURL() }));
      const choice = await new Promise<{ kind: string; id: string } | null>((resolve) => {
        displayPickResolver = resolve;
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.displayMediaRequest, { screens, tabs });
      });
      displayPickResolver = null;
      if (!choice) { callback({}); return; } // cancelled → deny
      if (choice.kind === "tab") {
        const wc = webContentsModule.fromId(Number(choice.id));
        callback(wc && !wc.isDestroyed() ? { video: wc.mainFrame } : {});
        return;
      }
      const src = srcMap.get(choice.id);
      callback(src ? { video: src } : {});
    } catch {
      callback({});
    }
  });
}
// The renderer calls this when it mounts a temp/incognito tab so its (fresh,
// non-persistent) partition gets the same browser permissions before it loads.
ipcMain.handle(IPC.browserPrepPartition, (_e, a: { partition: string }) => {
  try {
    if (a?.partition && !preppedPartitions.has(a.partition)) {
      preppedPartitions.add(a.partition);
      applyBrowserPerms(session.fromPartition(a.partition));
    }
  } catch { /* older Electron — perms just stay default */ }
  return { ok: true };
});
// Open a standalone second browser window (its own back/forward/reload + address
// bar) that SHARES the workspace browser session (same partition → same cookies /
// logins), so you can view two pages side by side in the same workspace. The window
// hosts a <webview> on the given partition; permissions are applied to that session.
ipcMain.handle(IPC.browserOpenWindow, (_e, a: { url?: string; partition?: string }) => {
  try {
    const partition = a?.partition || "persist:rcw-web";
    try { applyBrowserPerms(session.fromPartition(partition)); } catch { /* best-effort */ }
    const start = a?.url && /^https?:\/\//i.test(a.url) ? a.url : "about:blank";
    const win = new BrowserWindow({
      width: 1180,
      height: 820,
      title: "Redstone Browser",
      backgroundColor: "#15110d",
      webPreferences: { webviewTag: true, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(browserWindowHtml(partition, start))}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle(IPC.extensionSetEnabled, (_e, a: { id: string; enabled: boolean }) => setExtensionEnabled(a.id, !!a.enabled));
ipcMain.handle(IPC.extensionRemove, (_e, a: { id: string }) => removeExtension(a.id));

// Encrypted browser credential vault (autofill + save prompts).
ipcMain.handle(IPC.vaultAvailable, () => vaultAvailable());
ipcMain.handle(IPC.vaultList, () => listCredentials());
ipcMain.handle(IPC.vaultGetForOrigin, (_e, a: { origin: string }) => getCredentialForOrigin(a.origin));
ipcMain.handle(IPC.vaultSave, (_e, a: { origin: string; username: string; password: string }) => saveCredential(a.origin, a.username, a.password));
ipcMain.handle(IPC.vaultDelete, (_e, a: { origin: string; username: string }) => deleteCredential(a.origin, a.username));

// File browser — list / read / write, local or over ssh. Main never throws across IPC.
ipcMain.handle(IPC.filesList, (_e, a: { cwd: string; machine: string; dir: string }) =>
  listDir(a)
);
ipcMain.handle(IPC.filesSearch, (_e, a: Parameters<typeof searchFiles>[0]) => searchFiles(a));

// Streaming search: matches are pushed to the renderer as grep finds them, so the
// first results appear immediately instead of after the whole tree is walked. Each
// run is keyed by an id the renderer supplies, letting it cancel a superseded
// query (every keystroke) so we don't leave greps burning CPU on the remote host.
const liveSearches = new Map<string, { cancel: () => void }>();
ipcMain.handle(
  IPC.filesSearchStart,
  async (e, a: Parameters<typeof searchFiles>[0] & { searchId: string }) => {
    liveSearches.get(a.searchId)?.cancel();
    const wc = e.sender;
    const send = (payload: unknown) => {
      if (!wc.isDestroyed()) wc.send(IPC.filesSearchEvent, payload);
    };
    const handle = await searchFilesStream(
      a,
      (matches) => send({ searchId: a.searchId, matches }),
      (r) => {
        liveSearches.delete(a.searchId);
        send({ searchId: a.searchId, done: true, ...r });
      }
    );
    liveSearches.set(a.searchId, handle);
    // A reloaded/closed panel must not leave the grep running.
    wc.once("destroyed", () => {
      handle.cancel();
      liveSearches.delete(a.searchId);
    });
    return { ok: true };
  }
);
ipcMain.handle(IPC.filesSearchCancel, (_e, a: { searchId: string }) => {
  liveSearches.get(a.searchId)?.cancel();
  liveSearches.delete(a.searchId);
  return { ok: true };
});
ipcMain.handle(IPC.filesRead, (_e, a: { cwd: string; machine: string; file: string }) =>
  readFileAt(a)
);
ipcMain.handle(IPC.filesWrite, (_e, a: { cwd: string; machine: string; file: string; content: string }) =>
  writeFileAt(a)
);
ipcMain.handle(IPC.filesWriteBase64, (_e, a: { cwd: string; machine: string; file: string; base64: string }) =>
  writeFileBase64(a)
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
// Download: pick a local destination via the OS Save dialog, then stream/copy the
// session file there (no size cap — works for large binaries too).
ipcMain.handle(IPC.filesDownload, async (e, a: { cwd: string; machine: string; file: string }) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const suggested = a.file.split("/").pop() || "download";
    const picked = win
      ? await dialog.showSaveDialog(win, { defaultPath: suggested })
      : await dialog.showSaveDialog({ defaultPath: suggested });
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    const res = await downloadFileTo({ cwd: a.cwd, machine: a.machine, file: a.file, dest: picked.filePath });
    return { ...res, path: picked.filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
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
ipcMain.handle(IPC.clipboardRead, () => {
  try { return clipboard.readText(); } catch { return ""; }
});

// Runs inside each preview guest: swap blocking window dialogs for a non-blocking
// toast. Idempotent per document via the __rcwDialogsPatched guard.
const NEUTRALIZE_DIALOGS_JS = `(() => {
  if (window.__rcwDialogsPatched) return; window.__rcwDialogsPatched = true;
  const toast = (label, msg) => {
    try {
      let host = document.getElementById('__rcw_dialog_toast');
      if (!host) {
        host = document.createElement('div'); host.id = '__rcw_dialog_toast';
        host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;font:13px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif';
        (document.body || document.documentElement).appendChild(host);
      }
      const el = document.createElement('div');
      el.style.cssText = 'max-width:340px;padding:10px 12px;border-radius:8px;background:#1b1712;color:#f0e9dd;box-shadow:0 6px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.14);white-space:pre-wrap;word-break:break-word';
      if (label) { const b = document.createElement('div'); b.textContent = label; b.style.cssText='font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:3px'; el.appendChild(b); }
      el.appendChild(document.createTextNode(String(msg == null ? '' : msg)));
      host.appendChild(el);
      setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
    } catch (e) {}
  };
  try {
    window.alert = (msg) => { toast('alert', msg); };
    window.confirm = (msg) => { toast('confirm \\u2014 auto OK', msg); return true; };
    window.prompt = (msg, def) => { toast('prompt \\u2014 auto cancel', msg); return def == null ? null : def; };
  } catch (e) {}
})();`;

// Cmd/Ctrl + Left/Right = browser Back/Forward inside <webview> guests. Injected
// into the guest (keydown in a guest doesn't reach the host renderer). Skips
// editable fields so it never steals the caret-to-line-start/end shortcut while
// typing. Idempotent per document via __rcwNavKeys.
const NAV_KEYS_JS = `(() => {
  if (window.__rcwNavKeys) return; window.__rcwNavKeys = true;
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const el = document.activeElement;
    const tag = el && el.tagName;
    if (el && (el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') history.back(); else history.forward();
  }, true);
})();`;

// Right-click context menu (incl. Inspect Element) for the Browser tab's <webview>
// guests. Wired in the main process because the guest's context-menu can't be
// handled from the renderer.
app.on("web-contents-created", (_e, contents) => {
  if (contents.getType() !== "webview") return;
  // Belt-and-suspenders: a guest legitimately carries several forwarded webContents
  // listeners (loading, navigation, dom-ready, before-input, find, …). The default
  // cap of 10 tripped MaxListenersExceededWarning spam even at normal usage; raise it
  // so a genuine leak still surfaces (much higher) but ordinary use stays quiet.
  contents.setMaxListeners(40);
  // A <webview> guest swallows keydown — it never bubbles to the host window — so
  // forward its keys to the cockpit renderer's shortcut dispatcher too.
  contents.on("before-input-event", forwardShortcut);

  // Custom-app guests stay pinned to their own domain. A top-level navigation or
  // a popup (target=_blank / window.open) that leaves the app's site is cancelled
  // and opened in the session's in-app workspace browser as a new tab (never the
  // OS browser). Only guests the renderer registered (custom apps) are gated —
  // the Browser tab keeps free navigation.
  contents.on("will-navigate", (ev, url) => {
    const home = appGuestHomes.get(contents.id);
    if (!home || sameSite(url, home)) return;
    ev.preventDefault();
    openInWorkspaceBrowser(url);
  });
  contents.setWindowOpenHandler(({ url, disposition, features }) => {
    // A link/script asked for a NEW window/tab. Two cases, handled differently:
    //
    // 1. A GENUINE POPUP — window.open() with a target size / new-window disposition,
    //    e.g. "Sign in with Google", an OAuth consent, or a payment window. These
    //    NEED a real top-level window that keeps `window.opener` intact and shares
    //    the guest's session (same cookies/login) so the popup can postMessage its
    //    result back and self.close(). So we ALLOW it as a real popup window.
    // 2. A PLAIN NEW TAB — a target=_blank link click, middle-click, or bare
    //    window.open with no features. There is no opener contract to preserve, so
    //    we open it as a new tab in the session's in-app workspace browser (never a
    //    detached native window, never the OS browser).
    //
    // Non-http(s) schemes (mailto:, tel:, …) always go to the OS.
    if (url && !/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {/* ignore */});
      return { action: "deny" };
    }
    const isPopup = disposition === "new-window" || (!!features && /\b(width|height|left|top)\b/i.test(features));
    if (isPopup) {
      const { width, height } = popupWindowOptions(features);
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width, height,
          title: "Redstone",
          backgroundColor: "#15110d",
          autoHideMenuBar: true,
          minimizable: false,
          maximizable: false,
        },
      };
    }
    if (url) openInWorkspaceBrowser(url);
    return { action: "deny" };
  });
  contents.once("destroyed", () => appGuestHomes.delete(contents.id));

  // Neutralize blocking JS dialogs. A page calling alert()/confirm()/prompt()
  // would otherwise pop a NATIVE MODAL that freezes the preview (and the app).
  // Replace them with non-blocking equivalents that surface the text as a brief
  // in-page toast: alert → toast, confirm → auto-OK (true), prompt → default/null.
  // Injected at dom-ready and re-applied on navigation (each new document resets
  // the override). Self-contained — no renderer wiring needed.
  const patchDialogs = () => {
    contents.executeJavaScript(NEUTRALIZE_DIALOGS_JS, true).catch(() => {/* page gone / not ready */});
    contents.executeJavaScript(NAV_KEYS_JS, true).catch(() => {/* page gone / not ready */});
  };
  contents.on("dom-ready", patchDialogs);
  contents.on("did-navigate", patchDialogs);
  contents.on("did-navigate-in-page", patchDialogs);
  // ("Open in a new tab" for guest links is handled renderer-side — see
  // openTabIntercept.ts — so it works on a plain reload without a full relaunch.)

  // Cmd/Ctrl+F opens the workspace browser's in-page find bar. A keystroke while
  // the guest has focus never reaches the host renderer, so we intercept it here
  // and tell the embedder which guest to search (the panel matches by webContents
  // id). Esc while finding is likewise forwarded so the guest can close the bar.
  contents.on("before-input-event", (ev, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (mod && !input.alt && (input.key === "f" || input.key === "F")) {
      ev.preventDefault();
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.browserFind, { guestId: contents.id, action: "open" });
    } else if (input.key === "Escape") {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.browserFind, { guestId: contents.id, action: "close" });
    }
  });

  contents.on("context-menu", (_ev, params) => {
    const nav = contents.navigationHistory;
    const t: Electron.MenuItemConstructorOptions[] = [];
    const sep = () => { if (t.length && t[t.length - 1].type !== "separator") t.push({ type: "separator" }); };

    // Link actions (real-browser: open in a new tab of the session's workspace browser).
    if (params.linkURL) {
      t.push(
        { label: "Open Link in New Tab", click: () => openInWorkspaceBrowser(params.linkURL) },
        { label: "Open Link in Real Browser", click: () => shell.openExternal(params.linkURL).catch(() => {}) },
        { label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) },
      );
      sep();
    }
    // Image actions.
    if (params.mediaType === "image" && params.srcURL) {
      t.push(
        { label: "Open Image in New Tab", click: () => openInWorkspaceBrowser(params.srcURL) },
        { label: "Copy Image", click: () => contents.copyImageAt(params.x, params.y) },
        { label: "Copy Image Address", click: () => clipboard.writeText(params.srcURL) },
      );
      sep();
    }
    // Text editing (roles operate on the guest's current selection/field).
    if (params.isEditable && params.editFlags.canCut) t.push({ label: "Cut", role: "cut" });
    if (params.editFlags.canCopy || params.selectionText) t.push({ label: "Copy", role: "copy" });
    if (params.isEditable && params.editFlags.canPaste) t.push({ label: "Paste", role: "paste" });
    if (params.isEditable && params.editFlags.canSelectAll) t.push({ label: "Select All", role: "selectAll" });
    sep();

    t.push(
      { label: "Back", enabled: nav?.canGoBack?.() ?? false, click: () => nav?.goBack?.() },
      { label: "Forward", enabled: nav?.canGoForward?.() ?? false, click: () => nav?.goForward?.() },
      { label: "Reload", click: () => contents.reload() },
      { label: "Hard Reload (bypass cache)", click: () => contents.reloadIgnoringCache() },
      { type: "separator" },
      { label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) },
    );
    Menu.buildFromTemplate(t).popup();
  });
});

// ---------------------------------------------------------------------------
// HTTP Basic/Digest auth for the Browser tab's <webview> guests. Electron does
// NOT surface the browser's native "sign in" dialog for webview 401s, so pages
// behind Basic auth silently fail to load. We intercept the `login` event,
// collect credentials in a small modal, and hand them back to Chromium.
// ---------------------------------------------------------------------------
let authSeq = 0;
const pendingAuth = new Map<string, Promise<{ username: string; password: string } | null>>();

function promptForCredentials(
  parent: BrowserWindow | undefined,
  host: string,
  realm: string,
): Promise<{ username: string; password: string } | null> {
  return new Promise((resolve) => {
    const channel = `browser-auth:${authSeq++}`;
    const w = new BrowserWindow({
      width: 400, height: 250, parent, modal: !!parent, resizable: false,
      minimizable: false, maximizable: false, fullscreenable: false, title: "Sign in",
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    w.setMenuBarVisibility(false);
    let settled = false;
    function finish(v: { username: string; password: string } | null): void {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(channel, onMsg);
      resolve(v);
      if (!w.isDestroyed()) w.close();
    }
    function onMsg(_e: unknown, data: { username: string; password: string } | null): void {
      finish(data && typeof data.username === "string" ? data : null);
    }
    ipcMain.on(channel, onMsg);
    w.on("closed", () => finish(null));
    const esc = (s: string) => String(s).replace(/[<>&"']/g, "");
    const sub = `${esc(host)}${realm ? " — " + esc(realm) : ""}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font:13px -apple-system,system-ui,sans-serif;margin:0;padding:16px;background:#1b1712;color:#e8e2d8}
      h3{margin:0 0 4px;font-size:14px} p{margin:0 0 12px;color:#9a9186;font-size:12px;word-break:break-all}
      input{width:100%;box-sizing:border-box;margin:4px 0;padding:8px 10px;border-radius:8px;border:1px solid #3a332b;background:#241f19;color:#e8e2d8;font-size:13px;outline:none}
      .row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
      button{padding:7px 14px;border-radius:8px;border:1px solid #3a332b;background:#2c2620;color:#e8e2d8;font-size:12px;cursor:pointer}
      button.ok{background:#c1613a;border-color:#c1613a;color:#fff;font-weight:600}
    </style></head><body>
      <h3>Sign in</h3><p>${sub}</p>
      <input id="u" placeholder="Username" autocomplete="off" />
      <input id="p" type="password" placeholder="Password" autocomplete="off" />
      <div class="row"><button id="c">Cancel</button><button id="o" class="ok">Sign in</button></div>
      <script>
        const { ipcRenderer } = require('electron');
        const u = document.getElementById('u'), p = document.getElementById('p');
        const send = () => ipcRenderer.send('${channel}', { username: u.value, password: p.value });
        const cancel = () => ipcRenderer.send('${channel}', null);
        document.getElementById('o').onclick = send;
        document.getElementById('c').onclick = cancel;
        document.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); else if (e.key === 'Escape') cancel(); });
        u.focus();
      </script></body></html>`;
    void w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  });
}

app.on("login", (event, webContents, details, authInfo, callback) => {
  // Only handle server auth (401) for our own guests; leave proxy auth (407) alone.
  if (authInfo.isProxy) return;
  event.preventDefault();
  const embedder = (webContents as unknown as { hostWebContents?: Parameters<typeof BrowserWindow.fromWebContents>[0] })
    .hostWebContents;
  const parent =
    (embedder && BrowserWindow.fromWebContents(embedder)) || BrowserWindow.getAllWindows()[0] || undefined;
  // Coalesce parallel 401s for the same origin+realm (page + subresources) into
  // one dialog, so the user types credentials once.
  const key = `${authInfo.host}:${authInfo.port}:${authInfo.realm}`;
  let p = pendingAuth.get(key);
  if (!p) {
    p = promptForCredentials(parent ?? undefined, authInfo.host || details.url, authInfo.realm || "");
    pendingAuth.set(key, p);
    void p.finally(() => setTimeout(() => pendingAuth.delete(key), 500));
  }
  void p.then((creds) => (creds ? callback(creds.username, creds.password) : callback()));
});

app.whenReady().then(async () => {
  // Stream the current background video (range-capable) to the renderer. The
  // handler always serves whatever file is configured now, so changing it just
  // needs a fresh URL (mtime-versioned) on the renderer side.
  protocol.handle("rcw-media", async () => {
    const p = currentBgVideoPath();
    if (!p) return new Response("", { status: 404 });
    try {
      return await net.fetch(pathToFileURL(p).toString());
    } catch {
      return new Response("", { status: 404 });
    }
  });

  // Serve the packaged renderer over the fixed app:// origin (see the privileged-
  // scheme registration). app://bundle/<path> → the built renderer file; a path
  // that doesn't resolve to a real asset falls back to index.html (SPA routing).
  const rendererDir = join(here, "../renderer");
  // MIME types for media served with byte-range support (see below).
  const RANGE_MIME: Record<string, string> = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".webm": "video/webm", ".m4a": "audio/mp4",
  };
  protocol.handle("app", async (req) => {
    try {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "") || "index.html";
      // Contain within rendererDir — reject any ../ traversal out of the bundle.
      const abs = normalize(join(rendererDir, rel));
      if (abs !== rendererDir && !abs.startsWith(rendererDir + sep)) return new Response("", { status: 403 });
      // Byte-range support for media. Chromium fetches larger <audio>/<video> assets
      // with a Range header and expects 206 + Content-Range back. net.fetch over the
      // asar answers a Range request with a broken 200 + truncated body, so media
      // above ~32 KB fails to decode ("Format error") and stays silent. Serve the
      // requested slice ourselves so all sound effects play in the packaged app.
      const range = req.headers.get("Range");
      if (range) {
        try {
          const buf = await readFile(abs);
          const m = /bytes=(\d+)-(\d*)/.exec(range);
          if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
            const chunk = buf.subarray(start, end + 1);
            return new Response(chunk, {
              status: 206,
              headers: {
                "Content-Type": RANGE_MIME[extname(abs).toLowerCase()] || "application/octet-stream",
                "Content-Range": `bytes ${start}-${end}/${buf.length}`,
                "Accept-Ranges": "bytes",
                "Content-Length": String(chunk.length),
              },
            });
          }
        } catch {
          // Fall through to the normal net.fetch path (e.g. missing file → 404 below).
        }
      }
      try {
        return await net.fetch(pathToFileURL(abs).toString());
      } catch {
        // Missing asset → 404; missing route (no file extension) → index.html.
        if (extname(abs)) return new Response("", { status: 404 });
        return await net.fetch(pathToFileURL(join(rendererDir, "index.html")).toString());
      }
    } catch {
      return new Response("", { status: 404 });
    }
  });

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

  // Load enabled Chrome extensions into the shared browser session BEFORE any
  // <webview> mounts, so they apply to the first page a tab shows. Best-effort.
  await loadEnabledExtensions().catch(() => {});

  // Enable camera/mic + screen sharing inside the workspace browser. Electron denies
  // these by default; grant them for the app's own session and wire up a source for
  // getDisplayMedia (screen share in Meet/Zoom/etc). macOS still needs the app to
  // have the Screen Recording permission granted in System Settings.
  try {
    applyBrowserPerms(browserSession());
  } catch {
    /* older Electron / unsupported — screen share just stays unavailable */
  }

  createWindow();
  if (loadConfig()?.hasToken) {
    startForwarding();
  }
  primeCalendarPermission();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// On first launch, proactively trigger the macOS calendar permission prompt so the
// user grants (or declines) up front rather than only when they first add the Agenda
// widget. requestCalendarPermission() asks EventKit IN-PROCESS (via node-mac-
// permissions) so the prompt — and the Privacy › Calendars entry — is attributed to
// "Redstone Cowork", not to osascript. macOS shows the prompt at most once, so a
// one-time marker keeps us from re-priming on every launch.
function primeCalendarPermission(): void {
  if (process.platform !== "darwin") return;
  const marker = join(app.getPath("userData"), ".calendar-permission-primed");
  if (existsSync(marker)) return;
  try {
    writeFileSync(marker, new Date().toISOString());
  } catch {
    /* userData not writable — skip; the widget will prompt on demand instead */
  }
  // Delay slightly so the main window is on screen before the prompt appears.
  setTimeout(() => {
    requestCalendarPermission().catch(() => {
      /* best-effort; never block startup on calendar access */
    });
  }, 2500);
}

app.on("window-all-closed", () => {
  stopStream?.();
  stopStream = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopStream?.();
  stopStream = null;
  killAllTerminals();
  killAllDockerLogs();
  stopAllForwards();
  stopAllInspectors();
});
