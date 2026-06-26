import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

function configPath(): string {
  return path.join(app.getPath("userData"), "cowork-config.json");
}

interface StoredConfig {
  serverUrl: string;
  tokenEnc: string; // base64
}

export function saveConfig(serverUrl: string, token: string): void {
  let tokenEnc: string;
  if (safeStorage.isEncryptionAvailable()) {
    tokenEnc = safeStorage.encryptString(token).toString("base64");
  } else {
    tokenEnc = Buffer.from(token).toString("base64");
  }
  const data: StoredConfig = { serverUrl, tokenEnc };
  fs.writeFileSync(configPath(), JSON.stringify(data), "utf8");
}

export function loadConfig(): { serverUrl: string; hasToken: boolean } | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const data: StoredConfig = JSON.parse(raw);
    return { serverUrl: data.serverUrl, hasToken: !!data.tokenEnc };
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const data: StoredConfig = JSON.parse(raw);
    if (!data.tokenEnc) return null;
    const buf = Buffer.from(data.tokenEnc, "base64");
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    } else {
      return buf.toString("utf8");
    }
  } catch {
    return null;
  }
}

export function clearConfig(): void {
  try {
    fs.unlinkSync(configPath());
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}
