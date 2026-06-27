import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export type WorkspaceConfig = {
  forwardPorts: number[];
  browserUrl: string;
};

type Args = { sessionId: string; cwd: string; machine: string };
type SaveArgs = Args & { config: WorkspaceConfig };

const SSH_TIMEOUT_MS = 12_000;

/** A session runs on this machine when its `machine` matches the local hostname (case-insensitive). */
export function isLocalMachine(machine: string): boolean {
  return machine.trim().toLowerCase() === os.hostname().trim().toLowerCase();
}

/** Single-quote a value for safe interpolation into a remote shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Per-machine SSH host store (userData/ssh-hosts.json) — machine → ssh host.
// ---------------------------------------------------------------------------

function sshHostsStorePath(): string {
  return path.join(app.getPath("userData"), "ssh-hosts.json");
}

function readSshHosts(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(sshHostsStorePath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The stored ssh host for a machine, or the machine name itself as the default when unset. */
export function getSshHost(machine: string): string {
  try {
    const stored = readSshHosts()[machine];
    if (typeof stored === "string" && stored.trim().length > 0) return stored;
  } catch {
    // ignore — fall through to default
  }
  return machine;
}

export function setSshHost(machine: string, host: string): void {
  try {
    const all = readSshHosts();
    all[machine] = host;
    fs.writeFileSync(sshHostsStorePath(), JSON.stringify(all, null, 2), "utf8");
  } catch {
    // best-effort; never throw
  }
}

// ---------------------------------------------------------------------------
// Desktop-local config cache (userData/workspace-configs.json) — sessionId → config.
// ---------------------------------------------------------------------------

function cacheStorePath(): string {
  return path.join(app.getPath("userData"), "workspace-configs.json");
}

function readCache(): Record<string, WorkspaceConfig> {
  try {
    return JSON.parse(fs.readFileSync(cacheStorePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeCache(sessionId: string, config: WorkspaceConfig): void {
  try {
    const all = readCache();
    all[sessionId] = config;
    fs.writeFileSync(cacheStorePath(), JSON.stringify(all, null, 2), "utf8");
  } catch {
    // best-effort cache; never throw
  }
}

/** Run ssh with argv as an array (no shell concatenation). The remote command is a single string arg. */
function sshExec(sshHost: string, remoteCommand: string, stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "ssh",
      ["-o", "BatchMode=yes", "-o", `ConnectTimeout=8`, sshHost, remoteCommand],
      { timeout: SSH_TIMEOUT_MS },
      (err) => (err ? reject(err) : resolve())
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

/** Run ssh and resolve with the command's stdout. */
function sshCapture(sshHost: string, remoteCommand: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      ["-o", "BatchMode=yes", "-o", `ConnectTimeout=8`, sshHost, remoteCommand],
      { timeout: SSH_TIMEOUT_MS },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });
}

function normalizeConfig(parsed: Partial<WorkspaceConfig>): WorkspaceConfig {
  return {
    forwardPorts: Array.isArray(parsed.forwardPorts)
      ? parsed.forwardPorts.filter((n): n is number => Number.isFinite(n))
      : [],
    browserUrl: typeof parsed.browserUrl === "string" ? parsed.browserUrl : "",
  };
}

function localGitignoreEnsure(cwd: string): void {
  const gitignorePath = path.join(cwd, ".gitignore");
  let content = "";
  try {
    content = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    content = "";
  }
  const hasEntry = content
    .split("\n")
    .some((line) => line.trim() === ".redstone/" || line.trim() === ".redstone");
  if (!hasEntry) {
    const prefix = content.length && !content.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(gitignorePath, `${prefix}.redstone/\n`, "utf8");
  }
}

export async function saveWorkspaceConfig(
  args: SaveArgs
): Promise<{ ok: boolean; error?: string }> {
  const { sessionId, cwd, machine, config } = args;
  const clean = normalizeConfig(config);
  const json = JSON.stringify(clean, null, 2);
  try {
    if (isLocalMachine(machine)) {
      const dir = path.join(cwd, ".redstone");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "session.json"), json + "\n", "utf8");
      localGitignoreEnsure(cwd);
    } else {
      const sshHost = getSshHost(machine);
      const qCwd = shellQuote(cwd);
      // Create the dir and write the file from stdin.
      await sshExec(
        sshHost,
        `mkdir -p ${qCwd}/.redstone && cat > ${qCwd}/.redstone/session.json`,
        json + "\n"
      );
      // Ensure .gitignore contains .redstone/ only if absent.
      await sshExec(
        sshHost,
        `touch ${qCwd}/.gitignore && grep -qxF '.redstone/' ${qCwd}/.gitignore || echo '.redstone/' >> ${qCwd}/.gitignore`
      );
    }
    writeCache(sessionId, clean);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getWorkspaceConfig(args: Args): Promise<WorkspaceConfig | null> {
  const { sessionId, cwd, machine } = args;

  if (isLocalMachine(machine)) {
    // Local session — read the project file directly.
    try {
      const raw = fs.readFileSync(path.join(cwd, ".redstone", "session.json"), "utf8");
      return normalizeConfig(JSON.parse(raw) as Partial<WorkspaceConfig>);
    } catch {
      // not present locally — fall through to cache
    }
  } else {
    // Remote session — read the file over ssh.
    try {
      const qCwd = shellQuote(cwd);
      const raw = await sshCapture(getSshHost(machine), `cat ${qCwd}/.redstone/session.json`);
      return normalizeConfig(JSON.parse(raw) as Partial<WorkspaceConfig>);
    } catch {
      // unreachable / missing — fall through to cache
    }
  }

  // Fall back to the desktop-local cache keyed by sessionId.
  try {
    const cached = readCache()[sessionId];
    if (cached) return normalizeConfig(cached);
  } catch {
    // ignore
  }

  return null;
}
