import { PROBE_SOURCE_B64 } from "./probe-source.generated";

// ---------------------------------------------------------------------------
// Wire format + bootstrap for the remote probe channel.
//
// See resources/probe/rcw_probe.py for the other half. Both sides are
// newline-delimited JSON; nothing is ever written to the remote disk.
// ---------------------------------------------------------------------------

export type ProbeRequest = { id: number; m: string; p?: unknown };

export type ProbeResponse =
  | { id: number; ok: true; r: unknown }
  | { id: number; ok: false; e: { code: string; msg: string } };

export type ProbeEvent = { ev: string; p?: unknown };

/** A chunk of a streamed (large) response body. */
export type ProbeStreamChunk = { s: string; d?: string; end?: boolean };

export type ProbeFrame = ProbeResponse | ProbeEvent | ProbeStreamChunk;

/** The `{stream}` placeholder a large response carries in place of its body. */
export type StreamRef = { stream: string; enc: "b64+zlib"; len: number };

/** What the probe reports in its `ready` handshake. */
export type ProbeInfo = {
  proto: number;
  py: string;
  os: string;
  host: string;
  user: string;
  home: string;
  /** e.g. "tmux 3.3a", or null when tmux isn't installed. */
  tmux: string | null;
  caps: {
    /** tmux >= 3.0: `load-buffer -` accepts bytes on stdin (no temp file). */
    loadBufferStdin: boolean;
    /** /proc exists — Linux telemetry paths available. */
    proc: boolean;
  };
};

export function isStreamRef(v: unknown): v is StreamRef {
  return !!v && typeof v === "object" && typeof (v as StreamRef).stream === "string";
}

export function isStreamChunk(v: ProbeFrame): v is ProbeStreamChunk {
  return typeof (v as ProbeStreamChunk).s === "string";
}

export function isResponse(v: ProbeFrame): v is ProbeResponse {
  return typeof (v as ProbeResponse).id === "number";
}

export function isEvent(v: ProbeFrame): v is ProbeEvent {
  return typeof (v as ProbeEvent).ev === "string";
}

/**
 * The remote command that starts the probe.
 *
 * The obvious `ssh host "python3 -u -"` does NOT work: `python3 -` consumes the
 * ENTIRE stdin as the program, leaving no pipe for commands. So the program has to
 * arrive on argv, and it reads exactly one base64 line off stdin to exec — after
 * which stdin is free for the request stream.
 *
 * `exec` replaces the shell so nothing extra sits in the pipe (and most non-interactive
 * shell chatter is suppressed). Sourcing ~/.redstone/env first mirrors
 * ssh-install.ts:buildLaunchCommand, for hosts whose toolchain was provisioned into
 * userspace rather than system-wide.
 *
 * When python is missing we print one `fatal` frame and exit 42 so the desktop can
 * fall back to reduced (POSIX-shell) mode instead of hanging on a silent failure.
 */
export function buildBootstrapCommand(): string {
  return [
    '[ -f "$HOME/.redstone/env" ] && . "$HOME/.redstone/env";',
    "PY=$(command -v python3 || command -v python);",
    `[ -n "$PY" ] || { echo '{"ev":"fatal","p":{"code":"nopython"}}'; exit 42; };`,
    `exec "$PY" -u -c 'import sys,base64;exec(base64.b64decode(sys.stdin.readline()))'`,
  ].join(" ");
}

/** The single line written to the channel's stdin to load the program. */
export function bootstrapPayloadLine(): string {
  return PROBE_SOURCE_B64 + "\n";
}

/**
 * SSH options for the probe connection.
 *
 * `-T` is load-bearing: with a tty (`-t`/`-tt`) the remote echoes our own stdin back
 * at us and the frame stream is instantly corrupt.
 *
 * ServerAlive* is set HERE rather than in the shared `sshMuxOpts()` so adding
 * keepalives to a long-lived probe doesn't change behaviour for the terminal, file
 * browser, git and port-forward paths that also use those options.
 */
export function probeSshOpts(): string[] {
  return [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=12",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
  ];
}

/** Decode a streamed body (base64 of zlib-deflated UTF-8) back to text. */
export function decodeStream(b64: string, inflate: (buf: Buffer) => Buffer): string {
  return inflate(Buffer.from(b64, "base64")).toString("utf8");
}

/**
 * Parse one line into a frame, or null if it isn't JSON we recognise.
 *
 * Returning null rather than throwing is deliberate: a login banner, an `echo` in
 * the user's .bashrc, or an rbash refusal all land in this stream, and none of them
 * should kill the channel. The caller keeps a bounded sample of the junk for
 * diagnostics — silently discarding it makes a misconfigured host look like a hang.
 */
export function parseFrame(line: string): ProbeFrame | null {
  const t = line.trim();
  if (!t || t[0] !== "{") return null;
  try {
    const obj = JSON.parse(t) as ProbeFrame;
    if (!obj || typeof obj !== "object") return null;
    if (isResponse(obj) || isEvent(obj) || isStreamChunk(obj)) return obj;
    return null;
  } catch {
    return null;
  }
}
