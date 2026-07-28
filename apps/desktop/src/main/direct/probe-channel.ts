import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { inflateSync } from "node:zlib";
import {
  bootstrapPayloadLine,
  buildBootstrapCommand,
  decodeStream,
  isEvent,
  isResponse,
  isStreamChunk,
  isStreamRef,
  parseFrame,
  probeSshOpts,
  type ProbeInfo,
} from "./probe-protocol";

// ---------------------------------------------------------------------------
// One long-lived probe connection to one host.
//
// This is the offline edition's answer to the on-host agent: instead of installing
// a daemon that long-polls a server, the desktop holds a single SSH connection
// running a Python program fed over stdin. Nothing is installed, nothing phones
// home, and the desktop is the only client.
//
// One persistent connection (rather than a one-shot `ssh host "…"` per poll) matters
// most on Windows, where ssh-common.ts disables ControlMaster entirely — per-poll
// connections would pay a full handshake every time.
// ---------------------------------------------------------------------------

export type ChannelState = "idle" | "connecting" | "ready" | "backoff" | "closed";

export type ChannelEvents = {
  onEvent?: (name: string, payload: unknown) => void;
  onState?: (state: ChannelState, detail?: string) => void;
  onReady?: (info: ProbeInfo) => void;
};

export type SpawnFn = (cmd: string, args: string[]) => ChildProcessWithoutNullStreams;

export type ChannelOptions = {
  /** Machine name, for logging. */
  machine: string;
  /** ssh destination + extra opts; omit for a local (no-ssh) channel. */
  ssh?: { host: string; opts: string[] };
  /** Default per-request timeout. */
  timeoutMs?: number;
  /** Injectable for tests. */
  spawnFn?: SpawnFn;
  /** Injectable for tests; must not fire before `connect()`. */
  setTimeoutFn?: typeof setTimeout;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  /** Set once a response arrives referring to a stream we must reassemble. */
  stream?: string;
};

/** Backoff ladder. Steps stay short so a healthy blip reconnects fast. */
const BACKOFF_STEPS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

/**
 * If the connection keeps dying almost immediately, stop hammering: a burst of
 * failed SSH handshakes is exactly what fail2ban bans. The hosted agent has scar
 * tissue here too (see the tunnel loop in apps/hook-cli/src/agent.ts).
 */
const FLAP_WINDOW_MS = 8_000;
const FLAP_THRESHOLD = 6;
const FLAP_FLOOR_MS = 300_000;

/** A connection must stay up this long before its failure count resets. */
const HEALTHY_MS = 30_000;

/** Cap on retained non-JSON output (banners, rbash refusals) for diagnostics. */
const JUNK_LIMIT = 4 * 1024;

/** Kill and reconnect rather than buffer unboundedly — this means corrupt framing. */
const MAX_LINE_BUFFER = 8 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 15_000;

export class ProbeChannel {
  readonly machine: string;

  private opts: ChannelOptions;
  private events: ChannelEvents;
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: ChannelState = "idle";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private streams = new Map<string, { parts: string[]; id: number }>();
  private buffer = "";
  private junk = "";
  private stderr = "";
  private info: ProbeInfo | null = null;

  private failures = 0;
  private connectedAt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connecting = false;
  private stopped = false;

  constructor(opts: ChannelOptions, events: ChannelEvents = {}) {
    this.opts = opts;
    this.events = events;
    this.machine = opts.machine;
  }

  getState(): ChannelState { return this.state; }
  getInfo(): ProbeInfo | null { return this.info; }
  /** Non-JSON output seen on the channel — a login banner or an rbash refusal shows up here. */
  getDiagnostics(): { junk: string; stderr: string } { return { junk: this.junk, stderr: this.stderr }; }

  connect(): void {
    if (this.stopped || this.connecting || this.state === "ready") return;
    this.connecting = true;
    this.setState("connecting");

    const spawnFn = this.opts.spawnFn ?? ((c: string, a: string[]) => spawn(c, a) as ChildProcessWithoutNullStreams);
    const command = buildBootstrapCommand();

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.opts.ssh
        ? spawnFn("ssh", [...probeSshOpts(), ...this.opts.ssh.opts, this.opts.ssh.host, command])
        // Local host: skip ssh entirely. Same program, same protocol — which makes the
        // whole engine testable with no infrastructure, and makes the offline edition
        // work for someone running Claude on this machine with no SSH at all.
        : spawnFn("/bin/sh", ["-c", command]);
    } catch (e) {
      this.connecting = false;
      this.fail(e instanceof Error ? e.message : String(e));
      return;
    }

    this.child = child;
    this.connectedAt = Date.now();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-JUNK_LIMIT);
    });
    child.on("error", (e: Error) => { this.connecting = false; this.fail(e.message); });
    child.on("close", (code: number | null) => {
      this.connecting = false;
      this.fail(code === 42 ? "python3 not available on host" : `channel closed (code ${code})`);
    });

    // Hand the program over. Everything after this line is the request stream.
    try {
      child.stdin.write(bootstrapPayloadLine());
    } catch (e) {
      this.connecting = false;
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Close the channel and stop reconnecting. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.rejectAll(new Error("E_CHANNEL_CLOSED"));
    try { this.child?.stdin.end(); } catch { /* already gone */ }
    try { this.child?.kill(); } catch { /* already gone */ }
    this.child = null;
    this.setState("closed");
  }

  /** Issue a request. Rejects on timeout, remote error, or the channel dying. */
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.stopped) { reject(new Error("E_CHANNEL_CLOSED")); return; }
      const child = this.child;
      if (!child || this.state !== "ready") { reject(new Error("E_NOT_READY")); return; }

      const id = this.nextId++;
      const schedule = this.opts.setTimeoutFn ?? setTimeout;
      const timer = schedule(() => {
        // Tombstone the id so a late reply is discarded rather than resolving a
        // request the caller already gave up on.
        this.pending.delete(id);
        reject(new Error(`E_TIMEOUT: ${method}`));
      }, timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ id, m: method, p: params }) + "\n");
      } catch (e) {
        this.settle(id, null, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  // --- internals ---------------------------------------------------------

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BUFFER) {
      // No newline in 8 MB means the stream isn't what we think it is.
      this.buffer = "";
      this.fail("framing lost (no newline in 8MB)");
      return;
    }
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    for (const line of parts) this.onLine(line);
  }

  private onLine(line: string): void {
    const frame = parseFrame(line);
    if (!frame) {
      // Login banners, MOTDs, shell rc chatter. Keep a bounded sample: silently
      // discarding it turns a misconfigured host into an inscrutable hang.
      const t = line.trim();
      if (t) this.junk = (this.junk + t + "\n").slice(0, JUNK_LIMIT);
      return;
    }

    if (isStreamChunk(frame)) { this.onStreamChunk(frame.s, frame.d, frame.end === true); return; }

    if (isEvent(frame)) {
      if (frame.ev === "ready") {
        this.info = frame.p as ProbeInfo;
        this.failures = 0;
        this.connecting = false;
        this.setState("ready");
        this.events.onReady?.(this.info);
        return;
      }
      if (frame.ev === "fatal") {
        const code = (frame.p as { code?: string } | undefined)?.code ?? "fatal";
        this.fail(`probe fatal: ${code}`);
        return;
      }
      this.events.onEvent?.(frame.ev, frame.p);
      return;
    }

    if (isResponse(frame)) {
      if (frame.ok === false) {
        this.settle(frame.id, null, new Error(`${frame.e.code}: ${frame.e.msg}`));
        return;
      }
      if (isStreamRef(frame.r)) {
        // Body follows as chunks; hold the request open until the stream ends.
        const p = this.pending.get(frame.id);
        if (p) p.stream = frame.r.stream;
        this.streams.set(frame.r.stream, { parts: [], id: frame.id });
        return;
      }
      this.settle(frame.id, frame.r, null);
    }
  }

  private onStreamChunk(sid: string, data: string | undefined, end: boolean): void {
    const s = this.streams.get(sid);
    if (!s) return; // chunk for a request that already timed out
    if (data) s.parts.push(data);
    if (!end) return;
    this.streams.delete(sid);
    try {
      const text = decodeStream(s.parts.join(""), (b) => inflateSync(b));
      this.settle(s.id, JSON.parse(text), null);
    } catch (e) {
      this.settle(s.id, null, e instanceof Error ? e : new Error(String(e)));
    }
  }

  private settle(id: number, value: unknown, err: Error | null): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (err) p.reject(err); else p.resolve(value);
  }

  private rejectAll(err: Error): void {
    for (const [id] of [...this.pending]) this.settle(id, null, err);
    this.streams.clear();
  }

  private fail(detail: string): void {
    if (this.stopped) return;
    const wasReady = this.state === "ready";
    const uptime = Date.now() - this.connectedAt;

    try { this.child?.kill(); } catch { /* already gone */ }
    this.child = null;
    this.buffer = "";
    this.rejectAll(new Error(`E_CHANNEL_CLOSED: ${detail}`));

    // A connection that stayed healthy for a while isn't flapping — reset its count
    // so one blip after hours of uptime reconnects immediately.
    if (wasReady && uptime > HEALTHY_MS) this.failures = 0;

    // Index with the count BEFORE this failure, so the first retry uses the first
    // rung of the ladder. Incrementing first would skip 1s and start every host at 2s.
    const attempt = this.failures;
    this.failures++;

    const flapping = this.failures >= FLAP_THRESHOLD && uptime < FLAP_WINDOW_MS;
    const delay = flapping
      ? FLAP_FLOOR_MS
      : BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)];

    this.setState("backoff", detail);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const schedule = this.opts.setTimeoutFn ?? setTimeout;
    this.reconnectTimer = schedule(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }

  private setState(s: ChannelState, detail?: string): void {
    if (this.state === s) return;
    this.state = s;
    this.events.onState?.(s, detail);
  }
}
