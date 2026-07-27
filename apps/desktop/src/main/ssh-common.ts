import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// SSH connection multiplexing (ControlMaster) shared options.
//
// Opening a session spawns several ssh processes nearly simultaneously (the
// interactive terminal, one `-N -L` per forwarded port, config read/write, the
// connection test). That burst trips the remote's fail2ban / sshd MaxStartups
// and causes intermittent "Connection refused". ControlMaster=auto makes the
// first connection a master and routes all subsequent ssh operations (and port
// forwards) as channels over that single connection — no extra handshakes, no
// extra auth, far fewer connections.
//
// `%C` is an ssh token (a hash of local-host/remote-host/port/user) that ssh
// expands itself, so it stays literal in the string here. Using
// `~/.ssh/rcm-%C` keeps the unix-socket path well under macOS's ~104-char limit.
// ---------------------------------------------------------------------------

const SSH_DIR = path.join(os.homedir(), ".ssh");
const CONTROL_PATH = path.join(SSH_DIR, "rcm-%C");

/** Ensure ~/.ssh exists (mode 0700). Defensive — never throws. */
function ensureSshDir(): void {
  try {
    fs.mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  } catch {
    // best-effort; the ssh call will still work if the dir already exists
  }
}

// Ensure the directory once when the module loads.
ensureSshDir();

/**
 * SSH multiplexing options as an argv array. SAFE to combine with BatchMode,
 * ConnectTimeout, -tt, -N -L, etc.; order of `-o` flags doesn't matter. Must be
 * placed BEFORE the host argument. Never throws.
 */
export function sshMuxOpts(): string[] {
  // Windows OpenSSH does NOT support connection multiplexing — ControlMaster/ControlPath rely on
  // a Unix-domain socket, which Windows lacks. Passing them makes EVERY ssh the app runs fail with
  // "getsockname failed: Not a socket", so folder-browse and session-launch die even though install
  // worked. Return no mux options on Windows (each ssh is a fresh connection — slower, but correct).
  if (process.platform === "win32") return [];
  ensureSshDir();
  return [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${CONTROL_PATH}`,
    // Keep the master alive 5 min after the last channel closes so back-to-back
    // file clicks / terminal reopens reuse the warm connection instead of paying
    // the (relay-amplified) handshake again. Warmed on session open (warmSshMaster).
    "-o",
    "ControlPersist=300",
  ];
}
