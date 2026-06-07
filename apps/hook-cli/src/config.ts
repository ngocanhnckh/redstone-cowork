import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Config = { serverUrl: string; token: string };
export const configDir = () => process.env.RCW_CONFIG_DIR ?? join(homedir(), ".redstone");
const configPath = () => join(configDir(), "config.json");

export const loadCliConfig = (): Config | null => {
  try { return JSON.parse(readFileSync(configPath(), "utf8")); } catch { return null; }
};
export const saveCliConfig = (c: Config) => {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
};
