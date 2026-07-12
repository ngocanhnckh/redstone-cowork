import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { sshMuxOpts } from "./ssh-common";
import { buildRelayOpts, ensureCockpitKeyRegistered, probeTcp } from "./ssh-relay";
import { getHostTunnel, type TunnelCoordinates } from "./api";

export type WorkspaceConfig = {
  forwardPorts: number[];
  browserUrl: string;
  previewPort?: number | null;
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

// Server-known SSH targets (machine → "user@address"), auto-discovered from the
// host agents' registrations so the desktop can reach a machine WITHOUT the user
// configuring anything. A manual mapping in ssh-hosts.json still wins.
let serverHostTargets: Record<string, string> = {};
export function setServerHostTargets(targets: Record<string, string>): void {
  serverHostTargets = targets ?? {};
}

// Full server-known host records (machine → {id, address, sshPort, …}). Needed for
// the SSH relay: when a host is unreachable directly we look up its tunnel by hostId.
export type ServerHost = {
  id: string;
  machine: string;
  user: string | null;
  address: string | null;
  sshPort: number | null;
};
let serverHosts: Record<string, ServerHost> = {};

/** Feed the full /hosts list — builds both the string target map (for getSshHost)
 *  and the id-bearing record map (for getSshTarget's relay lookup). */
export function setServerHosts(hosts: ServerHost[]): void {
  const byMachine: Record<string, ServerHost> = {};
  const targets: Record<string, string> = {};
  for (const h of hosts ?? []) {
    byMachine[h.machine] = h;
    if (h.address) targets[h.machine] = h.user ? `${h.user}@${h.address}` : h.address;
  }
  serverHosts = byMachine;
  serverHostTargets = targets;
  probeCache.clear(); // host set changed → re-evaluate reachability
}

/**
 * Resolve a machine to an SSH target. Priority:
 *   1. a manual override in ssh-hosts.json (user intent wins),
 *   2. the address the host agent reported to cowork (auto — no setup needed),
 *   3. the bare machine name as a last resort (works if it's DNS/ssh-config resolvable).
 */
export function getSshHost(machine: string): string {
  try {
    const stored = readSshHosts()[machine];
    if (typeof stored === "string" && stored.trim().length > 0) return stored;
  } catch {
    // ignore — fall through
  }
  const auto = serverHostTargets[machine];
  if (typeof auto === "string" && auto.trim().length > 0) return auto;
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
// SSH target resolution WITH relay fallback (getSshTarget).
//
// Returns the host string (unchanged — kept for host-key identity / ssh config /
// end-to-end auth) plus extra ssh `-o` opts. For a directly-reachable host the
// opts are empty (current behavior). For a NAT'd host with no open port, the opts
// carry a `-o ProxyCommand=…` that jumps through the cowork relay. Fail-safe: any
// lookup error yields the plain direct host with no opts.
// ---------------------------------------------------------------------------

export type SshTarget = { host: string; opts: string[] };

const PROBE_TTL_MS = 30_000; // cache the reachability decision briefly (git poll / forwards)
const PROBE_TIMEOUT_MS = 2_500;
// Bound the relay lookup (registration + tunnel-coords API calls, which have no
// fetch timeout of their own). Without this, a stalled tunnel API would hang
// getSshTarget indefinitely — and a port forward built on it would sit at
// "starting" forever, never spawning ssh or reporting failure.
const RELAY_RESOLVE_TIMEOUT_MS = 8_000;
const DEFAULT_SSH_PORT = 22;

/** Reject with a timeout if `p` doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("relay resolution timed out")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

const probeCache = new Map<string, { at: number; target: SshTarget }>();

// Injectable for tests — default to the real net/API implementations.
let probeReachable: (host: string, port: number, timeoutMs: number) => Promise<boolean> = probeTcp;
let fetchTunnel: (hostId: string) => Promise<TunnelCoordinates> = getHostTunnel;
let ensureRegistered: () => Promise<boolean> = ensureCockpitKeyRegistered;

/** Test-only seam to inject fake reachability / tunnel-fetch / key-registration. */
export function __setRelayDepsForTest(deps: {
  probe?: typeof probeReachable;
  fetchTunnel?: typeof fetchTunnel;
  ensureRegistered?: typeof ensureRegistered;
}): void {
  if (deps.probe) probeReachable = deps.probe;
  if (deps.fetchTunnel) fetchTunnel = deps.fetchTunnel;
  if (deps.ensureRegistered) ensureRegistered = deps.ensureRegistered;
  probeCache.clear();
}

/** Extract the bare address (drop `user@`) from a `user@address` host string. */
function hostAddress(host: string): string {
  const at = host.lastIndexOf("@");
  return at >= 0 ? host.slice(at + 1) : host;
}

// A resolution plus whether it's a CONFIDENT answer (safe to cache) versus a
// transient fail-safe fallback (must NOT be cached — see getSshTarget).
type Resolved = SshTarget & { cacheable: boolean };

async function resolveSshTarget(machine: string): Promise<Resolved> {
  const host = getSshHost(machine);
  const rec = serverHosts[machine];
  const port = rec?.sshPort ?? DEFAULT_SSH_PORT;

  // 1. Direct-reachability probe. Probe REAL addresses, not the ssh string: the
  //    ssh string is often a ~/.ssh/config alias (e.g. "contabo2") that ssh can
  //    resolve but net.connect() CANNOT (net.connect ignores ssh_config). Probing
  //    the alias always fails and would wrongly trigger the relay. So we probe the
  //    agent-reported address (authoritative) first, then the bare ssh address.
  //    Reachable via EITHER → direct (ssh itself still connects via `host`).
  const candidates = [...new Set([rec?.address, hostAddress(host)].filter((a): a is string => !!a))];
  for (const addr of candidates) {
    try {
      if (await probeReachable(addr, port, PROBE_TIMEOUT_MS)) {
        return { host, opts: [], cacheable: true }; // confidently reachable directly
      }
    } catch {
      // probe threw → try the next candidate, else fall through to relay
    }
  }

  // 2. Unreachable directly → relay. A missing hostId or a failed relay lookup is
  //    a TRANSIENT condition — host records not synced yet, jump key not registered
  //    yet, or the tunnel fetch raced app startup. These fall back to the direct
  //    string so we never hard-fail, but they are marked NOT cacheable: caching a
  //    "couldn't reach the relay" fallback would keep a NAT'd host connecting to its
  //    (refused) direct :22 for the whole TTL even after the relay becomes available.
  if (!rec?.id) return { host, opts: [], cacheable: false };
  try {
    // Bounded so a stalled tunnel API can't hang the whole resolution (→ a forward
    // stuck at "starting" forever). On timeout/error we fall back to direct, marked
    // NOT cacheable so the next attempt retries the relay.
    const opts = await withTimeout(
      (async () => {
        if (!(await ensureRegistered())) return null;
        const coords = await fetchTunnel(rec.id!);
        return buildRelayOpts(coords);
      })(),
      RELAY_RESOLVE_TIMEOUT_MS,
    );
    if (opts) return { host, opts, cacheable: true }; // relay ready
    return { host, opts: [], cacheable: false };
  } catch {
    return { host, opts: [], cacheable: false };
  }
}

/**
 * Resolve a machine to an SSH target (host + extra opts), preferring a direct
 * connection and falling back to the cowork relay for NAT'd hosts. Cached per
 * machine for a short TTL so we don't TCP-probe on every git poll / forward.
 * Never throws.
 */
export async function getSshTarget(machine: string): Promise<SshTarget> {
  try {
    const cached = probeCache.get(machine);
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.target;
    const resolved = await resolveSshTarget(machine);
    const target: SshTarget = { host: resolved.host, opts: resolved.opts };
    // Only cache a CONFIDENT resolution (direct-reachable or relay-built). A
    // transient fail-safe fallback is left uncached so the very next call retries
    // and picks up the relay once records/registration are ready — otherwise a warm
    // that raced app startup would pin a NAT'd host to a refused direct connect.
    if (resolved.cacheable) probeCache.set(machine, { at: Date.now(), target });
    return target;
  } catch {
    // absolute last resort — never break a session
    return { host: getSshHost(machine), opts: [] };
  }
}

// De-dupe warming so opening several panels for one host fires a single connect.
const warming = new Map<string, number>();
const WARM_TTL_MS = 60_000;

/**
 * Establish (and keep warm via ControlPersist) the SSH master for a remote host,
 * in the background. Call this the moment a remote session's file/terminal/browser
 * UI opens, so the FIRST file read doesn't pay the connection handshake — which,
 * over the NAT relay (jump ssh + inner ssh), is several seconds and was the source
 * of the "click a file → freeze" stall. Fire-and-forget; never throws.
 */
export function warmSshMaster(machine: string): void {
  if (isLocalMachine(machine)) return;
  const last = warming.get(machine);
  if (last && Date.now() - last < WARM_TTL_MS) return; // already warmed recently
  warming.set(machine, Date.now());
  void getSshTarget(machine)
    .then((target) => {
      try {
        // `true` is a no-op remote command; its only purpose is to open the
        // ControlMaster so later channels attach instantly.
        execFile(
          "ssh",
          [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", target.host, "true"],
          { timeout: 20_000 },
          () => { /* best-effort — ignore result */ },
        );
      } catch {
        /* never throw from a warm-up */
      }
    })
    .catch(() => { /* target resolution failed — nothing to warm */ });
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
function sshExec(target: SshTarget, remoteCommand: string, stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "ssh",
      [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", `ConnectTimeout=8`, target.host, remoteCommand],
      { timeout: SSH_TIMEOUT_MS },
      (err) => (err ? reject(err) : resolve())
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

/** Run ssh and resolve with the command's stdout. */
function sshCapture(target: SshTarget, remoteCommand: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      [...sshMuxOpts(), ...target.opts, "-o", "BatchMode=yes", "-o", `ConnectTimeout=8`, target.host, remoteCommand],
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
    previewPort:
      typeof parsed.previewPort === "number" && Number.isFinite(parsed.previewPort)
        ? parsed.previewPort
        : null,
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
      const target = await getSshTarget(machine);
      const qCwd = shellQuote(cwd);
      // Create the dir and write the file from stdin.
      await sshExec(
        target,
        `mkdir -p ${qCwd}/.redstone && cat > ${qCwd}/.redstone/session.json`,
        json + "\n"
      );
      // Ensure .gitignore contains .redstone/ only if absent.
      await sshExec(
        target,
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
      const raw = await sshCapture(await getSshTarget(machine), `cat ${qCwd}/.redstone/session.json`);
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
