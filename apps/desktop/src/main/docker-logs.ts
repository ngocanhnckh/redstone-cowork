import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getSshTarget, isLocalMachine } from "./workspace";
import { sshMuxOpts } from "./ssh-common";

// Live `docker logs -f` streaming for the cockpit's Docker Log window. Modelled on
// terminal.ts but uses a plain child process (no PTY needed for a log tail) and a
// per-stream ring buffer so re-attaching a panel replays recent output. Like the
// terminal channels, nothing here ever throws across IPC — failures come back as
// { ok: false, error } or as an exit event.

const RING_BYTES = 256 * 1024; // ~256 KB replay buffer per stream
const TAIL_LINES = 300; // how much history `docker logs` seeds the stream with

type LogStream = {
  proc: ChildProcessWithoutNullStreams;
  container: string;
  buffer: string;
  onData: ((data: string) => void) | null;
  exited: boolean;
};

const streams = new Map<string, LogStream>();

function appendRing(s: LogStream, data: string): void {
  s.buffer += data;
  if (s.buffer.length > RING_BYTES) s.buffer = s.buffer.slice(s.buffer.length - RING_BYTES);
}

export type DockerLogArgs = { id: string; machine: string; container: string };
export type DockerLogResult = { ok: true; replay: string } | { ok: false; error: string };

/**
 * Ensure a `docker logs -f` stream exists for `id`. If one already runs for the
 * SAME container, (re)attach `onData` and return the buffered replay. If the
 * container changed (or the old stream died), the previous process is killed and a
 * fresh one is spawned. Never throws.
 */
export async function ensureDockerLog(
  args: DockerLogArgs,
  onData: (data: string) => void,
  onExit: () => void
): Promise<DockerLogResult> {
  const { id, machine, container } = args;
  if (!container) return { ok: false, error: "no container selected" };

  const existing = streams.get(id);
  if (existing && !existing.exited && existing.container === container) {
    existing.onData = onData;
    return { ok: true, replay: existing.buffer };
  }
  // Different container requested, or the previous stream ended — replace it.
  if (existing) {
    try {
      existing.proc.kill();
    } catch {
      // already dead
    }
    streams.delete(id);
  }

  try {
    // Container names/ids are constrained by Docker to [A-Za-z0-9][A-Za-z0-9_.-]*.
    // Sanitize to that charset before interpolating so this can never inject shell.
    const safe = container.replace(/[^A-Za-z0-9_.-]/g, "");
    if (!safe) return { ok: false, error: "invalid container name" };
    const dockerCmd = `docker logs --tail ${TAIL_LINES} --timestamps -f ${safe} 2>&1`;

    let proc: ChildProcessWithoutNullStreams;
    if (isLocalMachine(machine)) {
      proc = spawn("/bin/sh", ["-c", dockerCmd], { env: process.env });
    } else {
      const target = await getSshTarget(machine);
      proc = spawn("ssh", [...sshMuxOpts(), ...target.opts, target.host, dockerCmd], {
        env: process.env,
      });
    }

    const stream: LogStream = { proc, container, buffer: "", onData, exited: false };
    streams.set(id, stream);

    const push = (data: Buffer): void => {
      const text = data.toString("utf8");
      appendRing(stream, text);
      stream.onData?.(text);
    };
    proc.stdout.on("data", push);
    proc.stderr.on("data", push);
    proc.on("error", (e) => {
      const text = `\n[stream error] ${e.message}\n`;
      appendRing(stream, text);
      stream.onData?.(text);
    });
    proc.on("close", () => {
      stream.exited = true;
      onExit();
    });

    return { ok: true, replay: "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function stopDockerLog(id: string): void {
  try {
    const stream = streams.get(id);
    if (stream) {
      try {
        stream.proc.kill();
      } catch {
        // already dead
      }
      streams.delete(id);
    }
  } catch {
    // never throw across IPC
  }
}

/** Kill every log stream — call on app quit. */
export function killAllDockerLogs(): void {
  for (const [id] of streams) stopDockerLog(id);
}
