import { app, safeStorage } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * A small, OS-keychain-encrypted credential store for the workspace browser — the
 * practical stand-in for a password-manager extension (which can't run embedded).
 * Secrets are encrypted at rest with Electron's `safeStorage` (Keychain on macOS,
 * libsecret/DPAPI elsewhere). The whole credential array is sealed into one blob.
 */

export type Cred = { origin: string; username: string; password: string };

function vaultPath(): string {
  return join(app.getPath("userData"), "vault.json");
}

export function vaultAvailable(): boolean {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

async function readAll(): Promise<Cred[]> {
  try {
    const raw = await readFile(vaultPath(), "utf8");
    const parsed = JSON.parse(raw) as { enc?: string; encrypted?: boolean };
    if (!parsed.enc) return [];
    const buf = Buffer.from(parsed.enc, "base64");
    const json = parsed.encrypted && vaultAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as Cred[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(creds: Cred[]): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  const json = JSON.stringify(creds);
  const encrypted = vaultAvailable();
  const enc = encrypted
    ? safeStorage.encryptString(json).toString("base64")
    : Buffer.from(json, "utf8").toString("base64"); // fallback: not encrypted, just not plaintext
  await writeFile(vaultPath(), JSON.stringify({ enc, encrypted }), "utf8");
}

/** Origins + usernames only (no passwords) — safe to render in the manager UI. */
export async function listCredentials(): Promise<Array<{ origin: string; username: string }>> {
  return (await readAll()).map((c) => ({ origin: c.origin, username: c.username }));
}

/** The saved login for an origin (first match), incl. password — used for autofill. */
export async function getCredentialForOrigin(origin: string): Promise<{ username: string; password: string } | null> {
  const hit = (await readAll()).find((c) => c.origin === origin);
  return hit ? { username: hit.username, password: hit.password } : null;
}

/** Upsert a login (keyed by origin + username). */
export async function saveCredential(origin: string, username: string, password: string): Promise<{ ok: boolean }> {
  if (!origin || !password) return { ok: false };
  const all = await readAll();
  const i = all.findIndex((c) => c.origin === origin && c.username === username);
  if (i >= 0) all[i] = { origin, username, password };
  else all.push({ origin, username, password });
  await writeAll(all);
  return { ok: true };
}

export async function deleteCredential(origin: string, username: string): Promise<{ ok: boolean }> {
  const all = await readAll();
  await writeAll(all.filter((c) => !(c.origin === origin && c.username === username)));
  return { ok: true };
}
