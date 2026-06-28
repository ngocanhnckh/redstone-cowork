import { spawn, type ChildProcess } from "node:child_process";
import { getSshHost, isLocalMachine } from "./workspace";
import { sshMuxOpts } from "./ssh-common";

export type ForwardStatus = "local" | "starting" | "active" | "failed" | "stopped";

export type ForwardInfo = { port: number; status: ForwardStatus; error?: string };

type StatusCb = (port: number, status: ForwardStatus, error?: string) => void;

type Forward = {
  port: number;
  child: ChildProcess | null;
  status: ForwardStatus;
  error?: string;
  graceTimer: NodeJS.Timeout | null;
};

// How long the ssh child must stay alive before we treat the tunnel as active.
const GRACE_MS = 700;

// Keyed by `${sessionId}:${port}`.
const forwards = new Map<string, Forward>();

function key(sessionId: string, port: number): string {
  return `${sessionId}:${port}`;
}

export type StartArgs = { sessionId: string; machine: string; port: number };

/**
 * Ensure a forward for `{sessionId, port}` exists. Local machines need no tunnel
 * (`local`). Remote machines spawn `ssh -N -L port:localhost:port host`. Idempotent:
 * a live (active/starting) forward just re-reports its status. Never throws.
 */
export function startForward(args: StartArgs, onStatus: StatusCb): void {
  const { sessionId, machine, port } = args;
  const k = key(sessionId, port);

  // Local session — no tunnel needed.
  if (isLocalMachine(machine)) {
    forwards.set(k, { port, child: null, status: "local", graceTimer: null });
    onStatus(port, "local");
    return;
  }

  // Idempotent: already starting/active → just report current status.
  const existing = forwards.get(k);
  if (existing && (existing.status === "starting" || existing.status === "active")) {
    onStatus(port, existing.status, existing.error);
    return;
  }

  try {
    const host = getSshHost(machine);
    const child = spawn(
      "ssh",
      [
        "-N",
        ...sshMuxOpts(),
        "-o",
        "BatchMode=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ConnectTimeout=8",
        "-L",
        `${port}:localhost:${port}`,
        host,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );

    const fwd: Forward = { port, child, status: "starting", graceTimer: null };
    forwards.set(k, fwd);
    onStatus(port, "starting");

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) stderr = stderr.slice(stderr.length - 4096);
    });

    // After the grace period, if still running, treat as active.
    fwd.graceTimer = setTimeout(() => {
      fwd.graceTimer = null;
      // Only promote if we haven't already failed/stopped.
      if (forwards.get(k) === fwd && fwd.status === "starting") {
        fwd.status = "active";
        onStatus(port, "active");
      }
    }, GRACE_MS);

    const fail = (msg: string) => {
      if (fwd.graceTimer) {
        clearTimeout(fwd.graceTimer);
        fwd.graceTimer = null;
      }
      // Don't clobber an explicit stop.
      if (fwd.status === "stopped") return;
      fwd.status = "failed";
      fwd.error = (stderr.trim() || msg).slice(0, 500);
      fwd.child = null;
      onStatus(port, "failed", fwd.error);
    };

    child.on("error", (err) => {
      if (forwards.get(k) !== fwd) return;
      fail(err instanceof Error ? err.message : String(err));
    });

    child.on("exit", (code, signal) => {
      if (forwards.get(k) !== fwd) return;
      // A clean exit after we deliberately stopped is already handled.
      if (fwd.status === "stopped") return;
      fail(`ssh exited (code ${code ?? "null"}${signal ? `, signal ${signal}` : ""})`);
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    forwards.set(k, { port, child: null, status: "failed", error, graceTimer: null });
    onStatus(port, "failed", error);
  }
}

/** Kill the forward's ssh child and mark it stopped. Never throws. */
export function stopForward(sessionId: string, port: number): void {
  const k = key(sessionId, port);
  const fwd = forwards.get(k);
  if (!fwd) return;
  if (fwd.graceTimer) {
    clearTimeout(fwd.graceTimer);
    fwd.graceTimer = null;
  }
  fwd.status = "stopped";
  try {
    fwd.child?.kill();
  } catch {
    // already dead
  }
  fwd.child = null;
  forwards.delete(k);
}

/** Current forwards for a session (includes local entries). */
export function listForwards(sessionId: string): ForwardInfo[] {
  const prefix = `${sessionId}:`;
  const out: ForwardInfo[] = [];
  for (const [k, fwd] of forwards) {
    if (k.startsWith(prefix)) {
      out.push({ port: fwd.port, status: fwd.status, error: fwd.error });
    }
  }
  return out;
}

/** Kill every forward — call on app quit. */
export function stopAllForwards(): void {
  for (const [, fwd] of forwards) {
    if (fwd.graceTimer) {
      clearTimeout(fwd.graceTimer);
      fwd.graceTimer = null;
    }
    try {
      fwd.child?.kill();
    } catch {
      // already dead
    }
  }
  forwards.clear();
}
