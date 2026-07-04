import { BrowserWindow, webContents as webContentsModule, type WebContents } from "electron";
import { IPC } from "../shared/ipc";

// Browser inspector: streams Console + Network events from a session's in-app
// browser <webview> to the renderer's DevTools panel, using the Chrome DevTools
// Protocol (via webContents.debugger) so it mirrors Chrome's inspect element —
// scoped to that one guest. Falls back to plain console-message if the debugger
// can't attach (e.g. real DevTools already open on the guest).

type Inspector = {
  wc: WebContents;
  onConsole?: (...a: unknown[]) => void;
  onMessage?: (...a: unknown[]) => void;
  onDestroyed?: () => void;
};

const sessionBrowsers = new Map<string, number>(); // sessionId -> primary browser webContents id
const inspectors = new Map<string, Inspector>(); // sessionId -> active inspector
const pending = new Set<string>(); // sessions the panel wants inspected (survives browser reopen)

function emit(sessionId: string, ev: Record<string, unknown>): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.devtoolsEvent, { sessionId, ev });
}

/** The renderer's primary BrowserPanel reports its guest's webContents id here. */
export function registerSessionBrowser(sessionId: string, webContentsId: number): void {
  sessionBrowsers.set(sessionId, webContentsId);
  if (pending.has(sessionId) && !inspectors.has(sessionId)) attach(sessionId);
}
export function unregisterSessionBrowser(sessionId: string): void {
  sessionBrowsers.delete(sessionId);
  detach(sessionId); // browser closed — tear down; `pending` stays so it re-attaches on reopen
}

function target(sessionId: string): WebContents | null {
  const id = sessionBrowsers.get(sessionId);
  if (id == null) return null;
  const wc = webContentsModule.fromId(id);
  return wc && !wc.isDestroyed() ? wc : null;
}

/** Begin inspecting a session's browser. Returns whether a live target was found. */
export function startInspect(sessionId: string): { ok: boolean } {
  pending.add(sessionId);
  if (!inspectors.has(sessionId)) attach(sessionId);
  return { ok: inspectors.has(sessionId) };
}
export function stopInspect(sessionId: string): void {
  pending.delete(sessionId);
  detach(sessionId);
}

function attach(sessionId: string): void {
  const wc = target(sessionId);
  if (!wc) return;
  const insp: Inspector = { wc };

  let cdp = false;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    cdp = true;
    void wc.debugger.sendCommand("Network.enable").catch(() => {});
    void wc.debugger.sendCommand("Runtime.enable").catch(() => {});
    const onMessage = (_e: unknown, method: string, params: Record<string, unknown>) => handleCdp(sessionId, method, params);
    wc.debugger.on("message", onMessage as (...a: unknown[]) => void);
    insp.onMessage = onMessage as (...a: unknown[]) => void;
  } catch {
    cdp = false;
  }

  if (!cdp) {
    // Fallback: console text only (Electron's console-message event).
    const onConsole = (_e: unknown, level: number, message: string, line: number, source: string) =>
      emit(sessionId, { kind: "console", level: CONSOLE_LEVELS[level] ?? "log", text: message, source: `${basename(source)}:${line}`, ts: Date.now() });
    wc.on("console-message", onConsole as (...a: unknown[]) => void);
    insp.onConsole = onConsole as (...a: unknown[]) => void;
  }

  const onDestroyed = () => detach(sessionId);
  wc.once("destroyed", onDestroyed);
  insp.onDestroyed = onDestroyed;
  inspectors.set(sessionId, insp);
}

function detach(sessionId: string): void {
  const insp = inspectors.get(sessionId);
  if (!insp) return;
  inspectors.delete(sessionId);
  const { wc } = insp;
  try {
    if (!wc.isDestroyed()) {
      if (insp.onConsole) wc.off("console-message", insp.onConsole);
      if (insp.onMessage) wc.debugger.off("message", insp.onMessage);
      if (insp.onMessage && wc.debugger.isAttached()) wc.debugger.detach();
    }
  } catch {
    /* guest already gone */
  }
}

function handleCdp(sessionId: string, method: string, params: Record<string, unknown>): void {
  const p = params as Record<string, any>;
  switch (method) {
    case "Runtime.consoleAPICalled":
      emit(sessionId, {
        kind: "console",
        level: p.type ?? "log",
        text: (p.args ?? []).map(argToText).join(" "),
        ts: Date.now(),
      });
      break;
    case "Runtime.exceptionThrown": {
      const d = p.exceptionDetails ?? {};
      emit(sessionId, { kind: "console", level: "error", text: d.exception?.description ?? d.text ?? "Uncaught exception", ts: Date.now() });
      break;
    }
    case "Network.requestWillBeSent":
      emit(sessionId, { kind: "net-request", id: String(p.requestId), method: p.request?.method ?? "GET", url: p.request?.url ?? "", resType: p.type ?? "", ts: Date.now() });
      break;
    case "Network.responseReceived":
      emit(sessionId, { kind: "net-response", id: String(p.requestId), status: p.response?.status ?? 0, mime: p.response?.mimeType ?? "", resType: p.type ?? "" });
      break;
    case "Network.loadingFinished":
      emit(sessionId, { kind: "net-done", id: String(p.requestId), size: p.encodedDataLength ?? 0 });
      break;
    case "Network.loadingFailed":
      emit(sessionId, { kind: "net-failed", id: String(p.requestId), error: p.errorText ?? "failed", canceled: !!p.canceled });
      break;
  }
}

function argToText(a: any): string {
  if (a == null) return "";
  if (a.value !== undefined) return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
  if (a.description) return String(a.description);
  if (a.preview?.description) return String(a.preview.description);
  return String(a.type ?? "");
}

const CONSOLE_LEVELS = ["log", "warning", "error", "info", "debug"];
function basename(p: string): string {
  try { return p.split(/[\\/]/).pop() || p; } catch { return p; }
}

/** Tear everything down (app quit). */
export function stopAllInspectors(): void {
  for (const id of [...inspectors.keys()]) detach(id);
  pending.clear();
  sessionBrowsers.clear();
}
