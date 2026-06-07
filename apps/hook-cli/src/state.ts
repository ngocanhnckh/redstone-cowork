import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { configDir } from "./config";

const TTL_MS = 15 * 60_000;
const markerPath = (cwd: string, stateDir: string) =>
  join(stateDir, `armed-${createHash("sha256").update(cwd).digest("hex").slice(0, 16)}.json`);

export const armAttach = (cwd: string, stateDir = join(configDir(), "state")) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(markerPath(cwd, stateDir), JSON.stringify({ cwd, armedAt: Date.now() }));
};
export const isArmed = (cwd: string, stateDir = join(configDir(), "state")): boolean => {
  const p = markerPath(cwd, stateDir);
  if (!existsSync(p)) return false;
  try {
    const { armedAt } = JSON.parse(readFileSync(p, "utf8"));
    if (Date.now() - armedAt > TTL_MS) { rmSync(p, { force: true }); return false; }
    return true;
  } catch { return false; }
};
export const disarm = (cwd: string, stateDir = join(configDir(), "state")) =>
  rmSync(markerPath(cwd, stateDir), { force: true });
