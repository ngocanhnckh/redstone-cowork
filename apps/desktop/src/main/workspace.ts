import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

export type WorkspaceConfig = {
  sshHost: string;
  forwardPorts: number[];
  browserUrl: string;
};

type Args = { sessionId: string; cwd: string; machine: string };
type SaveArgs = Args & { config: WorkspaceConfig };

const SSH_TIMEOUT_MS = 12_000;

function isLocal(sshHost: string): boolean {
  return sshHost.trim().length === 0;
}

/** Single-quote a value for safe interpolation into a remote shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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
  const { sessionId, cwd, config } = args;
  const json = JSON.stringify(config, null, 2);
  try {
    if (isLocal(config.sshHost)) {
      const dir = path.join(cwd, ".redstone");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "session.json"), json + "\n", "utf8");
      localGitignoreEnsure(cwd);
    } else {
      const qCwd = shellQuote(cwd);
      // Create the dir and write the file from stdin.
      await sshExec(
        config.sshHost,
        `mkdir -p ${qCwd}/.redstone && cat > ${qCwd}/.redstone/session.json`,
        json + "\n"
      );
      // Ensure .gitignore contains .redstone/ only if absent.
      await sshExec(
        config.sshHost,
        `touch ${qCwd}/.gitignore && grep -qxF '.redstone/' ${qCwd}/.gitignore || echo '.redstone/' >> ${qCwd}/.gitignore`
      );
    }
    writeCache(sessionId, config);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getWorkspaceConfig(args: Args): Promise<WorkspaceConfig | null> {
  const { sessionId, cwd } = args;
  // 1. Try the local file (covers local sessions / same-machine).
  try {
    const raw = fs.readFileSync(path.join(cwd, ".redstone", "session.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>;
    return {
      sshHost: typeof parsed.sshHost === "string" ? parsed.sshHost : "",
      forwardPorts: Array.isArray(parsed.forwardPorts) ? parsed.forwardPorts : [],
      browserUrl: typeof parsed.browserUrl === "string" ? parsed.browserUrl : "",
    };
  } catch {
    // not present locally — fall through
  }
  // 2. Fall back to the desktop-local cache keyed by sessionId.
  try {
    const cached = readCache()[sessionId];
    if (cached) return cached;
  } catch {
    // ignore
  }
  // 3. Nothing found.
  return null;
}
