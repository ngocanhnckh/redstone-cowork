import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell, dialog, clipboard } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { saveConfig, loadConfig, clearConfig } from "./config";
import * as api from "./api";
import { getWorkspaceConfig, saveWorkspaceConfig, getSshHost, setSshHost, isLocalMachine, setServerHosts } from "./workspace";
import { getHostIps } from "./host-info";
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
import { listDir, readFileAt, writeFileAt, deletePath, makeDir, createFile, uploadLocalFile, searchFiles } from "./files";
import { gitInfo } from "./git";
import { IPC } from "../shared/ipc";

const here = dirname(fileURLToPath(import.meta.url));

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

// File browser — list / read / write, local or over ssh. Main never throws across IPC.
ipcMain.handle(IPC.filesList, (_e, a: { cwd: string; machine: string; dir: string }) =>
  listDir(a)
);
ipcMain.handle(IPC.filesSearch, (_e, a: Parameters<typeof searchFiles>[0]) => searchFiles(a));
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

// Right-click context menu (incl. Inspect Element) for the Browser tab's <webview>
// guests. Wired in the main process because the guest's context-menu can't be
// handled from the renderer.
app.on("web-contents-created", (_e, contents) => {
  if (contents.getType() !== "webview") return;

  // Neutralize blocking JS dialogs. A page calling alert()/confirm()/prompt()
  // would otherwise pop a NATIVE MODAL that freezes the preview (and the app).
  // Replace them with non-blocking equivalents that surface the text as a brief
  // in-page toast: alert → toast, confirm → auto-OK (true), prompt → default/null.
  // Injected at dom-ready and re-applied on navigation (each new document resets
  // the override). Self-contained — no renderer wiring needed.
  const patchDialogs = () => {
    contents.executeJavaScript(NEUTRALIZE_DIALOGS_JS, true).catch(() => {/* page gone / not ready */});
  };
  contents.on("dom-ready", patchDialogs);
  contents.on("did-navigate", patchDialogs);
  contents.on("did-navigate-in-page", patchDialogs);

  contents.on("context-menu", (_ev, params) => {
    const nav = contents.navigationHistory;
    const menu = Menu.buildFromTemplate([
      { label: "Back", enabled: nav?.canGoBack?.() ?? false, click: () => nav?.goBack?.() },
      { label: "Forward", enabled: nav?.canGoForward?.() ?? false, click: () => nav?.goForward?.() },
      { label: "Reload", click: () => contents.reload() },
      { label: "Hard Reload (bypass cache)", click: () => contents.reloadIgnoringCache() },
      { type: "separator" },
      ...(params.editFlags.canCopy ? [{ label: "Copy", role: "copy" as const }] : []),
      ...(params.editFlags.canPaste ? [{ label: "Paste", role: "paste" as const }] : []),
      ...(params.selectionText ? [{ label: "Copy Link Address", enabled: !!params.linkURL, click: () => clipboard.writeText(params.linkURL) }] : []),
      { type: "separator" },
      { label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) },
    ]);
    menu.popup();
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
  killAllDockerLogs();
  stopAllForwards();
});
