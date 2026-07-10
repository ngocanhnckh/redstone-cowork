import { app, session, dialog, type Session, type Extension } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rm, cp, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

// The one on-disk profile every workspace <webview> / custom app shares. Extensions
// load into THIS session so they apply across all browser tabs, like a real browser.
export const RCW_WEB_PARTITION = "persist:rcw-web";
export function browserSession(): Session {
  return session.fromPartition(RCW_WEB_PARTITION);
}

/** A managed extension: its unpacked copy lives under userData/extensions/<dir>. */
type ExtEntry = {
  dir: string; // folder name under the extensions root (a uuid)
  name: string;
  version: string;
  enabled: boolean;
};

/** What the renderer sees — registry data plus live-load status. */
export type ExtensionView = ExtEntry & {
  id: string; // stable = dir
  loaded: boolean;
  error?: string;
};

// Electron's runtime Extension id per managed dir (needed to removeExtension). Not
// persisted — recomputed each launch when we (re)load.
const loadedExtIds = new Map<string, string>(); // dir -> electron extension id
const loadErrors = new Map<string, string>(); // dir -> last load error

function extRoot(): string {
  return join(app.getPath("userData"), "extensions");
}
function registryPath(): string {
  return join(extRoot(), "registry.json");
}

async function readRegistry(): Promise<ExtEntry[]> {
  try {
    const raw = await readFile(registryPath(), "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ExtEntry[]) : [];
  } catch {
    return [];
  }
}
async function writeRegistry(entries: ExtEntry[]): Promise<void> {
  await mkdir(extRoot(), { recursive: true });
  await writeFile(registryPath(), JSON.stringify(entries, null, 2), "utf8");
}

/** Read an unpacked extension's manifest for a display name + version. Chrome i18n
 * placeholders (`__MSG_name__`) can't be resolved without the messages catalog, so
 * fall back to the folder-ish label the caller supplies. */
async function readManifest(dir: string, fallbackName: string): Promise<{ name: string; version: string }> {
  try {
    const m = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    let name = typeof m.name === "string" ? m.name : fallbackName;
    if (name.startsWith("__MSG_")) name = fallbackName;
    const version = typeof m.version === "string" ? m.version : "0";
    return { name, version };
  } catch {
    return { name: fallbackName, version: "0" };
  }
}

/** Extract a .crx/.zip into `dest`. A .crx is a zip with a header, so we slice from
 * the first local-file signature (`PK\x03\x04`) and unzip that. Uses the system
 * `unzip` (present on macOS/Linux); throws a clear message if it isn't available. */
async function extractArchive(src: string, dest: string): Promise<void> {
  const buf = await readFile(src);
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const start = buf.indexOf(sig);
  const zipBuf = start > 0 ? buf.subarray(start) : buf;
  const tmpZip = join(tmpdir(), `rcw-ext-${randomUUID()}.zip`);
  await writeFile(tmpZip, zipBuf);
  await mkdir(dest, { recursive: true });
  try {
    await execFileP("unzip", ["-o", "-q", tmpZip, "-d", dest]);
  } catch (e) {
    throw new Error(
      `couldn't unpack the archive (${e instanceof Error ? e.message : String(e)}). ` +
        `Unzip it yourself and add the unpacked folder instead.`
    );
  } finally {
    await rm(tmpZip, { force: true }).catch(() => {});
  }
}

/** Materialise the source (folder or archive) into a fresh managed dir. */
async function materialize(src: string): Promise<{ dir: string; abs: string }> {
  const dir = randomUUID();
  const abs = join(extRoot(), dir);
  await mkdir(abs, { recursive: true });
  const isArchive = /\.(crx|zip)$/i.test(src);
  if (isArchive) {
    await extractArchive(src, abs);
    // Some archives wrap everything in a single top-level folder; if manifest.json
    // isn't at the root but is one level down, hoist that subfolder.
    if (!existsSync(join(abs, "manifest.json"))) {
      const inner = await findManifestDir(abs);
      if (inner && inner !== abs) return { dir, abs: inner };
    }
  } else {
    await cp(src, abs, { recursive: true });
  }
  return { dir, abs };
}

/** Shallow search (depth ≤ 2) for the folder actually containing manifest.json. */
async function findManifestDir(root: string): Promise<string | null> {
  const { readdir } = await import("node:fs/promises");
  const tryDir = async (d: string): Promise<string | null> => {
    if (existsSync(join(d, "manifest.json"))) return d;
    return null;
  };
  if (await tryDir(root)) return root;
  try {
    for (const ent of await readdir(root, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const hit = await tryDir(join(root, ent.name));
        if (hit) return hit;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function absFor(dir: string): string {
  return join(extRoot(), dir);
}

/** Load one managed extension into the browser session; records id or error. */
async function loadOne(entry: ExtEntry): Promise<void> {
  loadErrors.delete(entry.dir);
  try {
    // The manifest may sit in a hoisted subfolder (see materialize); prefer it.
    const base = absFor(entry.dir);
    const dir = (await findManifestDir(base)) ?? base;
    const ext: Extension = await browserSession().loadExtension(dir, { allowFileAccess: true });
    loadedExtIds.set(entry.dir, ext.id);
  } catch (e) {
    loadErrors.set(entry.dir, e instanceof Error ? e.message : String(e));
  }
}

/** Unload one managed extension from the browser session (no-op if not loaded). */
function unloadOne(dir: string): void {
  const id = loadedExtIds.get(dir);
  if (!id) return;
  try { browserSession().removeExtension(id); } catch { /* already gone */ }
  loadedExtIds.delete(dir);
}

/** Load every enabled extension. Call once at startup, BEFORE any webview mounts. */
export async function loadEnabledExtensions(): Promise<void> {
  const reg = await readRegistry();
  for (const e of reg) if (e.enabled) await loadOne(e);
}

/** Registry + live status for the UI. */
export async function listExtensions(): Promise<ExtensionView[]> {
  const reg = await readRegistry();
  return reg.map((e) => ({
    ...e,
    id: e.dir,
    loaded: loadedExtIds.has(e.dir),
    error: loadErrors.get(e.dir),
  }));
}

/** Open a picker (folder or .crx/.zip), install it, and load it. */
export async function chooseAndAddExtension(): Promise<{ ok: boolean; error?: string; added?: ExtensionView }> {
  const res = await dialog.showOpenDialog({
    title: "Add a Chrome extension",
    message: "Pick an unpacked extension folder, or a .crx / .zip file",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Extension", extensions: ["crx", "zip"] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  return addExtension(res.filePaths[0]);
}

/** Install an extension from a folder or archive path, then load it. */
export async function addExtension(src: string): Promise<{ ok: boolean; error?: string; added?: ExtensionView }> {
  try {
    await access(src);
    const { dir, abs } = await materialize(src);
    const label = src.split(/[\\/]/).filter(Boolean).pop() ?? "extension";
    const { name, version } = await readManifest(abs, label);
    const entry: ExtEntry = { dir, name, version, enabled: true };
    const reg = await readRegistry();
    reg.push(entry);
    await writeRegistry(reg);
    await loadOne(entry);
    const err = loadErrors.get(dir);
    return {
      ok: !err,
      error: err,
      added: { ...entry, id: dir, loaded: loadedExtIds.has(dir), error: err },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Extract a 32-char Chrome extension id from a Web Store URL or a raw id. */
function extensionIdFrom(input: string): string | null {
  const s = input.trim();
  if (/^[a-p]{32}$/.test(s)) return s;
  const m = s.match(/[a-p]{32}/); // the id in a .../detail/<name>/<id> URL
  return m ? m[0] : null;
}

/**
 * Install an extension straight from a Chrome Web Store URL (or id) by downloading
 * its CRX from Google's update endpoint, then materialising + loading it like any
 * other .crx. NOTE: the embedded browser can't run the Web Store's own "Add to
 * Chrome" flow (it only offers that to real Chrome), so this is the way in. Many
 * extensions work; native-messaging ones (1Password/etc) still won't.
 */
export async function installFromWebStore(idOrUrl: string): Promise<{ ok: boolean; error?: string; added?: ExtensionView }> {
  const id = extensionIdFrom(idOrUrl);
  if (!id) return { ok: false, error: "Couldn't find an extension id in that — paste a Chrome Web Store link or the 32-char id." };
  const url =
    `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3` +
    `&prodversion=120.0.0.0&x=${encodeURIComponent(`id=${id}&installsource=ondemand&uc`)}`;
  const tmpCrx = join(tmpdir(), `rcw-ext-${id}.crx`);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { ok: false, error: `download failed (HTTP ${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return { ok: false, error: "downloaded file is too small to be a real extension" };
    await writeFile(tmpCrx, buf);
    return await addExtension(tmpCrx);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await rm(tmpCrx, { force: true }).catch(() => {});
  }
}

/** Enable/disable a managed extension (load or unload it live + persist the flag). */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  const reg = await readRegistry();
  const entry = reg.find((e) => e.dir === id);
  if (!entry) return { ok: false };
  entry.enabled = enabled;
  await writeRegistry(reg);
  if (enabled) await loadOne(entry);
  else unloadOne(id);
  return { ok: true };
}

/** Remove a managed extension: unload, delete its files, drop the registry entry. */
export async function removeExtension(id: string): Promise<{ ok: boolean }> {
  unloadOne(id);
  const reg = await readRegistry();
  const next = reg.filter((e) => e.dir !== id);
  await writeRegistry(next);
  loadErrors.delete(id);
  await rm(absFor(id), { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}
