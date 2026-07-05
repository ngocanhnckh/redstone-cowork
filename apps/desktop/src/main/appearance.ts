import { app, dialog, BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import { statSync, readFileSync } from "node:fs";
import path from "node:path";

// Custom background image support + the macOS "keep wallpaper in fullscreen" fix.
// The chosen image is persisted as a data-URL text file in userData so it survives
// restarts and can be handed straight to a CSS background-image in the renderer
// (a data URL always loads, unlike a file:// URL from the app origin).

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB — keep the data URL sane

function storePath(): string {
  return path.join(app.getPath("userData"), "bg-image.txt");
}

/** Open the picker, read the chosen image into a data URL, persist it, and return it. */
export async function chooseBgImage(
  win: BrowserWindow | undefined,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error?: string }> {
  try {
    const picked = await dialog.showOpenDialog(win!, {
      title: "Choose background image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false };
    const src = picked.filePaths[0];
    const buf = await fs.readFile(src);
    if (buf.length > MAX_BYTES) return { ok: false, error: "image too large (max 12 MB)" };
    const mime = MIME[path.extname(src).toLowerCase()] ?? "image/png";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    await fs.writeFile(storePath(), dataUrl, "utf8");
    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The persisted background image data URL, or null if none is set. */
export async function getBgImage(): Promise<string | null> {
  try {
    const s = await fs.readFile(storePath(), "utf8");
    return s.trim() || null;
  } catch {
    return null;
  }
}

/** Forget the persisted background image. */
export async function clearBgImage(): Promise<void> {
  try {
    await fs.unlink(storePath());
  } catch {
    /* already gone */
  }
}

/**
 * Toggle macOS "simple" fullscreen. Native fullscreen moves the window to its own
 * Space with a black backing, so the vibrancy/desktop wallpaper disappears behind
 * it. Simple fullscreen just resizes the window to fill the current screen — the
 * wallpaper (and vibrancy) stays visible, the menu bar/dock hide. This only works
 * because the window is NOT `transparent: true` (a transparent window blanks under
 * simple fullscreen — see the window-creation note). No-op off macOS.
 */
export function setSimpleFullscreen(win: BrowserWindow | undefined, on: boolean): boolean {
  if (!win) return false;
  if (process.platform !== "darwin") {
    win.setFullScreen(on);
    return win.isFullScreen();
  }
  if (on && win.isFullScreen()) win.setFullScreen(false); // leave native first
  win.setSimpleFullScreen(on);
  return win.isSimpleFullScreen();
}

/** Whether the window is in either native or simple fullscreen right now. */
export function isFullscreen(win: BrowserWindow | undefined): boolean {
  if (!win) return false;
  return win.isFullScreen() || win.isSimpleFullScreen();
}

// ---------------------------------------------------------------------------
// Background video: an optional looping video (with audio) shown as the app
// backdrop instead of the desktop wallpaper. The chosen file can be large, so we
// store only its PATH and stream it to the renderer over the custom rcw-media://
// protocol (range-capable) rather than copying or base64-ing it.
// ---------------------------------------------------------------------------
function videoStorePath(): string {
  return path.join(app.getPath("userData"), "bg-video.txt");
}

/** Open the picker, remember the chosen video's path, and return its stream URL. */
export async function chooseBgVideo(
  win: BrowserWindow | undefined,
): Promise<{ ok: true; url: string } | { ok: false; error?: string }> {
  try {
    const picked = await dialog.showOpenDialog(win!, {
      title: "Choose background video",
      properties: ["openFile"],
      filters: [{ name: "Video", extensions: ["mp4", "webm", "mov", "m4v", "mkv", "ogg"] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false };
    await fs.writeFile(videoStorePath(), picked.filePaths[0], "utf8");
    const url = getBgVideoUrl();
    return url ? { ok: true, url } : { ok: false, error: "could not read the chosen file" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The absolute path of the current background video, or null. */
export function currentBgVideoPath(): string | null {
  try {
    const p = readFileSync(videoStorePath(), "utf8").trim();
    return p || null;
  } catch {
    return null;
  }
}

/** A cache-busted rcw-media:// URL for the current video (versioned by mtime), or null. */
export function getBgVideoUrl(): string | null {
  const p = currentBgVideoPath();
  if (!p) return null;
  let v = 0;
  try { v = Math.floor(statSync(p).mtimeMs); } catch { return null; }
  return `rcw-media://bg/video?v=${v}`;
}

export async function clearBgVideo(): Promise<void> {
  try { await fs.unlink(videoStorePath()); } catch { /* already gone */ }
}

/**
 * Toggle the macOS window vibrancy (the frosted "under-window" desktop material).
 * With vibrancy OFF, transparent CSS regions show the RAW desktop instead of the
 * frost — used for the "fully transparent HUD" look. No-op off macOS. Restoring
 * re-applies "under-window" to match how the window was created.
 */
export function setVibrancy(win: BrowserWindow | undefined, on: boolean): void {
  if (!win || process.platform !== "darwin") return;
  win.setVibrancy(on ? "under-window" : null);
}
