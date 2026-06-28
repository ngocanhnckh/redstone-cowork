import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import * as api from "./api";
import { setSshHost } from "./workspace";
import { sshMuxOpts } from "./ssh-common";

// ---------------------------------------------------------------------------
// Passwordless SSH onboarding — desktop half.
//
// One-click flow: ensure a local ed25519 keypair, ask the remote redstone
// agent (via the cowork server) to authorize the public key passwordlessly,
// write a managed `Host <alias>` block into ~/.ssh/config, then verify the
// connection. Never throws across IPC — every path returns a result object.
// ---------------------------------------------------------------------------

const SSH_DIR = path.join(os.homedir(), ".ssh");
const KEY_PATH = path.join(SSH_DIR, "id_ed25519");
const PUB_PATH = `${KEY_PATH}.pub`;
const CONFIG_PATH = path.join(SSH_DIR, "config");

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 12_000;

export type SshSetupArgs = {
  sessionId: string;
  machine: string;
  hostNameOverride?: string;
};

export type SshSetupResult =
  | { stage: "keygen"; ok: false; error: string }
  | { stage: "authorize"; ok: false; error: string }
  | { stage: "need-host"; ok: false; needHostName: true; user?: string; port?: number }
  | { stage: "done"; ok: boolean; error?: string; alias: string; hostName: string };

function ensureSshDir(): void {
  fs.mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(SSH_DIR, 0o700);
  } catch {
    // best-effort on platforms without POSIX modes
  }
}

/** Ensure ~/.ssh/id_ed25519 exists, generating it if absent. Returns the trimmed public key. */
export function ensureKeypair(): { ok: true; publicKey: string } | { ok: false; error: string } {
  try {
    ensureSshDir();
    if (!fs.existsSync(PUB_PATH)) {
      execFileSync("ssh-keygen", [
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        KEY_PATH,
        "-C",
        `redstone@${os.hostname()}`,
      ]);
    }
    const publicKey = fs.readFileSync(PUB_PATH, "utf8").trim();
    if (!publicKey) return { ok: false, error: "public key is empty" };
    return { ok: true, publicKey };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Idempotently write a managed `Host <alias>` block into ~/.ssh/config between
 * `# >>> redstone <alias>` / `# <<< redstone <alias>` markers. Replaces an
 * existing block with the same markers; otherwise appends. Never disturbs other content.
 */
export function writeSshConfigBlock(args: {
  alias: string;
  hostName: string;
  user: string;
  port: number;
}): void {
  const { alias, hostName, user, port } = args;
  ensureSshDir();

  const begin = `# >>> redstone ${alias}`;
  const end = `# <<< redstone ${alias}`;
  const block = [
    begin,
    `Host ${alias}`,
    `  HostName ${hostName}`,
    `  User ${user}`,
    `  Port ${port}`,
    `  IdentityFile ~/.ssh/id_ed25519`,
    `  StrictHostKeyChecking accept-new`,
    end,
  ].join("\n");

  let existing = "";
  try {
    existing = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch {
    existing = "";
  }

  const beginIdx = existing.indexOf(begin);
  let next: string;
  if (beginIdx !== -1) {
    const endIdx = existing.indexOf(end, beginIdx);
    if (endIdx !== -1) {
      const after = endIdx + end.length;
      next = existing.slice(0, beginIdx) + block + existing.slice(after);
    } else {
      // Malformed (begin without end) — append a fresh block rather than clobber.
      next = existing.replace(/\n*$/, "") + (existing.trim() ? "\n\n" : "") + block + "\n";
    }
  } else {
    next = existing.replace(/\n*$/, "") + (existing.trim() ? "\n\n" : "") + block + "\n";
  }

  fs.writeFileSync(CONFIG_PATH, next, { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // best-effort
  }
}

/** Test a passwordless ssh connection to `alias`. ok when exit 0; otherwise stderr. */
export function testConnection(alias: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      "ssh",
      [
        ...sshMuxOpts(),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "StrictHostKeyChecking=accept-new",
        alias,
        "true",
      ],
      { timeout: TEST_TIMEOUT_MS },
      (err, _stdout, stderr) => {
        if (!err) {
          resolve({ ok: true });
          return;
        }
        const msg = (stderr || "").trim() || (err instanceof Error ? err.message : String(err));
        resolve({ ok: false, error: msg });
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Orchestrate the full setup. Never throws — all outcomes are returned as SshSetupResult. */
export async function sshSetup(args: SshSetupArgs): Promise<SshSetupResult> {
  const { sessionId, machine, hostNameOverride } = args;

  // 1. Ensure a local keypair.
  const key = ensureKeypair();
  if (!key.ok) return { stage: "keygen", ok: false, error: key.error };

  // 2. Ask the agent to authorize the public key.
  const startedAt = Date.now();
  try {
    await api.authorizeSsh(sessionId, key.publicKey);
  } catch (e) {
    return {
      stage: "authorize",
      ok: false,
      error: `Failed to reach the server: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 3. Poll for a fresh result (one whose `at` is newer than when we started).
  let result: api.SshResult | null = null;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let latest: api.SshResult | null = null;
    try {
      latest = await api.getSshResult(sessionId);
    } catch {
      latest = null;
    }
    if (latest && Date.parse(latest.at) >= startedAt) {
      result = latest;
      break;
    }
  }

  if (!result) {
    return {
      stage: "authorize",
      ok: false,
      error: "No response from the agent — is a `redstone claude` session running on this host?",
    };
  }

  // 4. Agent reported a failure.
  if (result.ok === false) {
    return { stage: "authorize", ok: false, error: result.error || "agent reported failure" };
  }

  // 5. Determine the host name; prompt the UI if we don't have one.
  const hostName = (hostNameOverride && hostNameOverride.trim()) || result.address || "";
  if (!hostName) {
    return {
      stage: "need-host",
      ok: false,
      needHostName: true,
      user: result.user,
      port: result.port,
    };
  }

  // 6. Write the ssh config block + point the machine's ssh host at the alias.
  writeSshConfigBlock({
    alias: machine,
    hostName,
    user: result.user || "root",
    port: result.port || 22,
  });
  setSshHost(machine, machine);

  // 7. Verify.
  const test = await testConnection(machine);
  return { stage: "done", ok: test.ok, error: test.error, alias: machine, hostName };
}
