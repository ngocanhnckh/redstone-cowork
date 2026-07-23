import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

function configPath(): string {
  return path.join(app.getPath("userData"), "cowork-config.json");
}

interface StoredConfig {
  serverUrl: string;
  tokenEnc: string; // base64 — the Bearer sent on every request
  refreshEnc?: string; // base64 — Redstone refresh token (org mode only)
}

function enc(value: string): string {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString("base64")
    : Buffer.from(value).toString("base64");
}
function dec(value: string): string {
  const buf = Buffer.from(value, "base64");
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
}
function read(): StoredConfig | null {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as StoredConfig;
  } catch {
    return null;
  }
}

/** Persist the connection. `refreshToken` is set for org (Redstone) sessions only. */
export function saveConfig(serverUrl: string, token: string, refreshToken?: string): void {
  const data: StoredConfig = { serverUrl, tokenEnc: enc(token), ...(refreshToken ? { refreshEnc: enc(refreshToken) } : {}) };
  fs.writeFileSync(configPath(), JSON.stringify(data), "utf8");
}

/** Replace the access (and optionally refresh) token after a silent refresh; keeps serverUrl. */
export function updateTokens(token: string, refreshToken?: string): void {
  const cur = read();
  if (!cur) return;
  const data: StoredConfig = {
    serverUrl: cur.serverUrl,
    tokenEnc: enc(token),
    refreshEnc: refreshToken ? enc(refreshToken) : cur.refreshEnc,
  };
  fs.writeFileSync(configPath(), JSON.stringify(data), "utf8");
}

export function loadConfig(): { serverUrl: string; hasToken: boolean; isOrg: boolean; isAccount: boolean } | null {
  const data = read();
  if (!data) return null;
  let isAccount = false;
  try {
    isAccount = !!data.tokenEnc && dec(data.tokenEnc).startsWith("rcwa_");
  } catch { /* undecryptable token — treat as non-account */ }
  return { serverUrl: data.serverUrl, hasToken: !!data.tokenEnc, isOrg: !!data.refreshEnc, isAccount };
}

export function getToken(): string | null {
  const data = read();
  if (!data?.tokenEnc) return null;
  try { return dec(data.tokenEnc); } catch { return null; }
}

export function getRefreshToken(): string | null {
  const data = read();
  if (!data?.refreshEnc) return null;
  try { return dec(data.refreshEnc); } catch { return null; }
}

export function clearConfig(): void {
  try {
    fs.unlinkSync(configPath());
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}
