import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

// Optional per-server SSH passwords, encrypted at rest with Electron safeStorage
// (Keychain on macOS). Keyed by lowercase `user@host` so it survives server-id changes.

const FILE = path.join(app.getPath("userData"), "ssh-creds.json");
const keyOf = (sshUser: string, host: string) => `${(sshUser || "").toLowerCase()}@${(host || "").toLowerCase()}`;

function enc(v: string): string {
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString("base64") : Buffer.from(v).toString("base64");
}
function dec(v: string): string {
  const buf = Buffer.from(v, "base64");
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
}
function read(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, string>; } catch { return {}; }
}
function write(all: Record<string, string>): void {
  try { fs.writeFileSync(FILE, JSON.stringify(all), { mode: 0o600 }); } catch { /* ignore */ }
}

export function saveSshPassword(sshUser: string, host: string, password: string): void {
  const all = read();
  all[keyOf(sshUser, host)] = enc(password);
  write(all);
}
export function getSshPassword(sshUser: string, host: string): string | null {
  const v = read()[keyOf(sshUser, host)];
  try { return v ? dec(v) : null; } catch { return null; }
}
export function forgetSshPassword(sshUser: string, host: string): void {
  const all = read();
  delete all[keyOf(sshUser, host)];
  write(all);
}
