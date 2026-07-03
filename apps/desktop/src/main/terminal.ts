import type { IPty } from "node-pty";
import { getSshTarget, isLocalMachine } from "./workspace";
import { sshMuxOpts } from "./ssh-common";

// node-pty is a native module externalized from the main bundle — require it lazily
// and defensively so a load failure can be surfaced as an error string, never a crash.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyModule: typeof import("node-pty") | null = null;
function loadPty(): typeof import("node-pty") {
  if (!ptyModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    ptyModule = require("node-pty") as typeof import("node-pty");
  }
  return ptyModule;
}

const RING_BYTES = 200 * 1024; // ~200 KB replay buffer per terminal

type Term = {
  pty: IPty;
  buffer: string;
  onData: ((data: string) => void) | null;
  exited: boolean;
};

const terminals = new Map<string, Term>();

export type EnsureArgs = {
  id: string;
  cwd: string;
  machine: string;
  cols: number;
  rows: number;
};

export type EnsureResult = { ok: true; replay: string } | { ok: false; error: string };

/** Single-quote a value for safe interpolation into a remote shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appendRing(term: Term, data: string): void {
  term.buffer += data;
  if (term.buffer.length > RING_BYTES) {
    term.buffer = term.buffer.slice(term.buffer.length - RING_BYTES);
  }
}

/**
 * Ensure a PTY exists for `id`. If one already runs, (re)attach `onData` and return
 * the buffered replay. Otherwise spawn a local shell or an ssh session. Never throws.
 */
export async function ensureTerminal(
  args: EnsureArgs,
  onData: (data: string) => void,
  onExit: () => void
): Promise<EnsureResult> {
  const { id, cwd, machine, cols, rows } = args;

  const existing = terminals.get(id);
  if (existing && !existing.exited) {
    existing.onData = onData;
    return { ok: true, replay: existing.buffer };
  }
  // A dead terminal (e.g. ssh failed / shell exited) is replaced by a fresh spawn,
  // so reopening the tab or fixing the ssh host restarts it rather than replaying.
  if (existing) terminals.delete(id);

  try {
    const pty = loadPty();
    const safeCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80;
    const safeRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;

    let child: IPty;
    if (isLocalMachine(machine)) {
      const shell = process.env.SHELL || "/bin/bash";
      child = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: safeCols,
        rows: safeRows,
        cwd,
        env: process.env as Record<string, string>,
      });
    } else {
      const target = await getSshTarget(machine);
      const remoteCmd = `cd ${shellQuote(cwd)} && exec $SHELL -l`;
      child = pty.spawn("ssh", ["-tt", ...sshMuxOpts(), ...target.opts, target.host, remoteCmd], {
        name: "xterm-256color",
        cols: safeCols,
        rows: safeRows,
        env: process.env as Record<string, string>,
      });
    }

    const term: Term = { pty: child, buffer: "", onData, exited: false };
    terminals.set(id, term);

    child.onData((data) => {
      appendRing(term, data);
      term.onData?.(data);
    });

    child.onExit(() => {
      term.exited = true;
      onExit();
    });

    return { ok: true, replay: "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function writeTerminal(id: string, data: string): void {
  try {
    const term = terminals.get(id);
    if (term && !term.exited) term.pty.write(data);
  } catch {
    // never throw across IPC
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  try {
    const term = terminals.get(id);
    if (!term || term.exited) return;
    const c = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80;
    const r = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
    term.pty.resize(c, r);
  } catch {
    // ignore — resize is best-effort
  }
}

export function killTerminal(id: string): void {
  try {
    const term = terminals.get(id);
    if (term) {
      try {
        term.pty.kill();
      } catch {
        // already dead
      }
      terminals.delete(id);
    }
  } catch {
    // never throw across IPC
  }
}

/** Kill every PTY — call on app quit. */
export function killAllTerminals(): void {
  for (const [id] of terminals) killTerminal(id);
}
