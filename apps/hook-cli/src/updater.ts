import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { configDir, loadCliConfig } from "./config";

/** Path the launcher execs: `node ~/.redstone/redstone.js`. `update` overwrites this in place. */
export const bundlePath = (): string => join(configDir(), "redstone.js");

export type UpdateDeps = {
  fetchImpl?: typeof fetch;
  /** Cache-bust timestamp source — injectable for tests. */
  now?: () => number;
  /** Persist the downloaded bundle (default: atomic temp-write + rename). */
  write?: (path: string, data: string) => void;
  /** Config loader — injectable for tests. */
  loadConfig?: typeof loadCliConfig;
};

/** The bundle is ~25KB; anything tiny is an error page / truncated download, not a real bundle. */
const MIN_BUNDLE_BYTES = 1000;

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, { mode: 0o644 });
  renameSync(tmp, path); // rename is atomic — a concurrent hook never reads a half-written file
}

/**
 * Re-download the latest agent bundle from the configured server and overwrite the
 * installed one in place. Cache-busted + no-store so a CDN never serves a stale copy.
 * Returns a result rather than throwing — the caller prints the message.
 */
export async function runUpdate(deps: UpdateDeps = {}): Promise<{ ok: boolean; message: string }> {
  const load = deps.loadConfig ?? loadCliConfig;
  const cfg = load();
  if (!cfg) return { ok: false, message: "not configured — run `redstone init` first" };

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const write = deps.write ?? atomicWrite;
  const url = `${cfg.serverUrl}/install/redstone.js?t=${now()}`;

  let body: string;
  try {
    const res = await fetchImpl(url, { headers: { "Cache-Control": "no-store" } });
    if (!res.ok) return { ok: false, message: `download failed: HTTP ${res.status} from ${url}` };
    body = await res.text();
  } catch (e) {
    return { ok: false, message: `download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (body.length < MIN_BUNDLE_BYTES) {
    return { ok: false, message: "downloaded bundle looks invalid (too small) — left existing bundle untouched" };
  }

  write(bundlePath(), body);
  return {
    ok: true,
    message: `updated -> ${bundlePath()} (${body.length} bytes)\nNew hook events use it immediately; restart any running \`redstone claude\` session to update its wrapper/poller.`,
  };
}
