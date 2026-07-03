import { app } from "electron";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { registerCockpitKey, type TunnelCoordinates } from "./api";

// ---------------------------------------------------------------------------
// NAT'd-host SSH relay support (desktop / cockpit side).
//
// Hosts with no inbound SSH port are reached by jumping through a locked-down
// `rcwtun` user on the cowork server, which reverse-forwards each agent's :22 to
// a loopback port. The cockpit reaches that port with `ssh -W localhost:<port>`
// as a ProxyCommand. Authentication to the real host is UNCHANGED (the user's own
// keys, end-to-end); only the transport is relayed. The jump keypair below auths
// ONLY to `rcwtun` (which can do nothing but forward to the relay loopback).
//
// Everything here is fail-safe: any error resolves to a "not available" result so
// directly-reachable hosts are never affected.
// ---------------------------------------------------------------------------

function jumpKeyPath(): string {
  return path.join(app.getPath("userData"), "rcw_jump_ed25519");
}

/** Dedicated known_hosts for the relay so it never pollutes the user's ~/.ssh. */
export function relayKnownHostsPath(): string {
  return path.join(app.getPath("userData"), "relay_known_hosts");
}

function markerPath(): string {
  return path.join(app.getPath("userData"), "rcw_jump_registered");
}

/**
 * Ensure an ed25519 jump keypair exists in userData. Generates it via ssh-keygen
 * on first need. Returns the private key path, or null if generation failed.
 * Never throws.
 */
export function ensureJumpKey(): Promise<string | null> {
  const keyPath = jumpKeyPath();
  try {
    if (fs.existsSync(keyPath) && fs.existsSync(`${keyPath}.pub`)) return Promise.resolve(keyPath);
  } catch {
    // fall through to (re)generate
  }
  return new Promise((resolve) => {
    try {
      execFile(
        "ssh-keygen",
        ["-t", "ed25519", "-N", "", "-C", "rcw-cockpit-jump", "-f", keyPath],
        (err) => resolve(err ? null : keyPath)
      );
    } catch {
      resolve(null);
    }
  });
}

// Register the jump pubkey with the relay exactly once (per install). An in-memory
// flag short-circuits the common case; a marker file survives restarts.
let registered = false;

/**
 * Ensure this desktop's jump pubkey is registered on the relay. Idempotent and
 * fail-safe: returns false if the key is missing or the API call failed, in which
 * case the caller falls back to a direct connection.
 */
export async function ensureCockpitKeyRegistered(): Promise<boolean> {
  if (registered) return true;
  try {
    if (fs.existsSync(markerPath())) {
      registered = true;
      return true;
    }
  } catch {
    // ignore — try to register
  }
  const keyPath = await ensureJumpKey();
  if (!keyPath) return false;
  try {
    const pub = fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
    if (!pub) return false;
    await registerCockpitKey(pub, os.hostname());
    try {
      fs.writeFileSync(markerPath(), new Date().toISOString(), "utf8");
    } catch {
      // marker is best-effort; the in-memory flag still avoids re-posting this run
    }
    registered = true;
    return true;
  } catch {
    return false;
  }
}

/** Single-quote a path for embedding inside a ProxyCommand (ssh runs it via /bin/sh). */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the ssh `-o ProxyCommand=...` opts that jump through the relay to reach a
 * NAT'd host's reverse-forwarded loopback port. Paths are quoted because userData
 * on macOS lives under "Application Support" (contains a space).
 */
export function buildRelayOpts(coords: TunnelCoordinates): string[] {
  const proxy =
    `ssh -i ${shQuote(jumpKeyPath())}` +
    ` -o StrictHostKeyChecking=accept-new` +
    ` -o UserKnownHostsFile=${shQuote(relayKnownHostsPath())}` +
    // Publickey-only / non-interactive so a rejected jump key fails as ONE clean
    // attempt instead of falling through none/password/keyboard-interactive — the
    // multi-method sequence is what fail2ban bans as a brute-force login.
    ` -o BatchMode=yes` +
    ` -o IdentitiesOnly=yes` +
    ` -o PreferredAuthentications=publickey` +
    ` -o PasswordAuthentication=no` +
    ` -o KbdInteractiveAuthentication=no` +
    ` -o NumberOfPasswordPrompts=0` +
    ` -o ConnectTimeout=10` +
    ` -W localhost:${coords.tunnelPort}` +
    ` -p ${coords.relayPort}` +
    ` ${coords.tunnelUser}@${coords.relayHost}`;
  return ["-o", `ProxyCommand=${proxy}`];
}

/**
 * Probe direct TCP reachability of `host:port` with a short timeout. Resolves true
 * if a connection is established, false on timeout/error. Never throws.
 */
export function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    let socket: net.Socket;
    try {
      socket = net.connect({ host, port });
    } catch {
      resolve(false);
      return;
    }
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
