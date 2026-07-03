import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const execFileP = promisify(execFile);

/** Relay coordinates returned by the server's tunnel provisioning endpoint. */
export type TunnelCoordinates = {
  relayHost: string;
  relayPort: number;
  tunnelUser: string;
  tunnelPort: number;
};

export type TunnelKey = { pubkey: string; privKeyPath: string };

/** Path to the agent's dedicated tunnel private key inside the redstone config dir. */
export function tunnelKeyPath(home: string): string {
  return join(home, "tunnel_ed25519");
}

/** Path to the pinned known_hosts file used for the relay connection. */
export function relayKnownHostsPath(home: string): string {
  return join(home, "relay_known_hosts");
}

/**
 * Ensure an ed25519 keypair exists at `<home>/tunnel_ed25519`. If absent, generate
 * it via ssh-keygen. Returns the public key string + private key path, or `null` on
 * any failure (agent-safe: never throws — a missing key just disables the tunnel).
 */
export async function ensureTunnelKey(home: string): Promise<TunnelKey | null> {
  try {
    const privKeyPath = tunnelKeyPath(home);
    const pubKeyPath = `${privKeyPath}.pub`;
    if (!existsSync(pubKeyPath) || !existsSync(privKeyPath)) {
      await execFileP(
        "ssh-keygen",
        ["-t", "ed25519", "-N", "", "-C", "redstone-tunnel", "-f", privKeyPath],
        { timeout: 15_000 }
      );
    }
    const pubkey = readFileSync(pubKeyPath, "utf8").trim();
    if (!pubkey) return null;
    return { pubkey, privKeyPath };
  } catch {
    return null;
  }
}

/**
 * Assemble the ssh argv for the persistent reverse tunnel. Pure + deterministic so
 * it can be unit-tested. Maps the relay's `tunnelPort` back to this host's :22.
 */
export function buildTunnelArgs(
  coords: TunnelCoordinates,
  privKeyPath: string,
  knownHostsPath: string
): string[] {
  return [
    "-N",
    "-T",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${knownHostsPath}`,
    // Publickey-only, non-interactive: never fall through to `none`/`password`/
    // keyboard-interactive. A rejected key must fail as ONE clean attempt, not a
    // multi-method sequence that fail2ban reads as a brute-force login.
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "PreferredAuthentications=publickey",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "NumberOfPasswordPrompts=0",
    "-o", "ConnectTimeout=10",
    "-i", privKeyPath,
    "-R", `${coords.tunnelPort}:localhost:22`,
    "-p", String(coords.relayPort),
    `${coords.tunnelUser}@${coords.relayHost}`,
  ];
}
