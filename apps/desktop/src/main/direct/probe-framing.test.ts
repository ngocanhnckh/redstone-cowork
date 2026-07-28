import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { deflateSync } from "node:zlib";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ProbeChannel } from "./probe-channel";
import { parseFrame } from "./probe-protocol";

// Deterministic framing tests with a fake transport. The real-python integration
// test (probe-channel.test.ts) can't guarantee a payload big enough to trigger
// streaming, or a host that prints a login banner — so those paths are driven
// explicitly here.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { setEncoding(e: string): void };
  stderr = new EventEmitter() as EventEmitter & { setEncoding(e: string): void };
  written: string[] = [];
  stdin = {
    write: (s: string) => { this.written.push(s); return true; },
    end: () => {},
  };
  killed = false;
  kill(): boolean { this.killed = true; return true; }

  constructor() {
    super();
    this.stdout.setEncoding = () => {};
    this.stderr.setEncoding = () => {};
  }

  /** Feed raw text as if it came from the remote. */
  emitRaw(text: string): void { this.stdout.emit("data", text); }
  emitFrame(obj: unknown): void { this.emitRaw(JSON.stringify(obj) + "\n"); }
  ready(): void {
    this.emitFrame({
      ev: "ready",
      p: { proto: 1, py: "3.9.6", os: "linux", host: "h", user: "u", home: "/home/u", tmux: "tmux 3.3a", caps: { loadBufferStdin: true, proc: true } },
    });
  }
}

function makeChannel(): { ch: ProbeChannel; child: FakeChild; events: Array<[string, unknown]> } {
  const child = new FakeChild();
  const events: Array<[string, unknown]> = [];
  const ch = new ProbeChannel(
    { machine: "test", spawnFn: () => child as unknown as ChildProcessWithoutNullStreams },
    { onEvent: (n, p) => events.push([n, p]) },
  );
  ch.connect();
  return { ch, child, events };
}

describe("parseFrame", () => {
  it("accepts responses, events and stream chunks", () => {
    expect(parseFrame('{"id":1,"ok":true,"r":{}}')).toMatchObject({ id: 1, ok: true });
    expect(parseFrame('{"ev":"hb","p":{}}')).toMatchObject({ ev: "hb" });
    expect(parseFrame('{"s":"s1","d":"x"}')).toMatchObject({ s: "s1" });
  });

  it("rejects non-JSON and non-frame JSON without throwing", () => {
    expect(parseFrame("Welcome to Ubuntu 24.04 LTS")).toBeNull();
    expect(parseFrame("")).toBeNull();
    expect(parseFrame("{broken")).toBeNull();
    expect(parseFrame('{"unrelated":true}')).toBeNull();
  });
});

describe("ProbeChannel framing", () => {
  it("sends the bootstrap payload as one line before any request", () => {
    const { child } = makeChannel();
    expect(child.written).toHaveLength(1);
    expect(child.written[0].endsWith("\n")).toBe(true);
    // Exactly one newline: python's readline() must get the whole program.
    expect(child.written[0].split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("reassembles a streamed response and resolves the original request", async () => {
    const { ch, child } = makeChannel();
    child.ready();

    const body = { text: "x".repeat(200_000) };
    const p = ch.request<{ text: string }>("tmux.capturePane");

    const b64 = deflateSync(Buffer.from(JSON.stringify(body), "utf8")).toString("base64");
    child.emitFrame({ id: 1, ok: true, r: { stream: "s1", enc: "b64+zlib", len: 200_000 } });
    // Split across several chunks, as the probe does for anything over 64 KB.
    for (let i = 0; i < b64.length; i += 5_000) child.emitFrame({ s: "s1", d: b64.slice(i, i + 5_000) });
    child.emitFrame({ s: "s1", end: true });

    await expect(p).resolves.toEqual(body);
  });

  it("survives a login banner interleaved with frames", async () => {
    const { ch, child } = makeChannel();
    child.emitRaw("Welcome to Ubuntu 24.04 LTS\nLast login: Mon\n");
    child.ready();
    const p = ch.request("probe.ping");
    child.emitRaw("* Documentation: https://help.ubuntu.com\n");
    child.emitFrame({ id: 1, ok: true, r: { pong: true } });
    await expect(p).resolves.toEqual({ pong: true });
    // Junk is retained for diagnostics rather than silently dropped — otherwise a
    // misconfigured host is indistinguishable from a hang.
    expect(ch.getDiagnostics().junk).toContain("Welcome to Ubuntu");
  });

  it("handles a frame split across two stdout chunks", async () => {
    const { ch, child } = makeChannel();
    child.ready();
    const p = ch.request("probe.ping");
    const line = JSON.stringify({ id: 1, ok: true, r: { pong: true } });
    child.emitRaw(line.slice(0, 12));
    child.emitRaw(line.slice(12) + "\n");
    await expect(p).resolves.toEqual({ pong: true });
  });

  it("rejects on a remote error frame and stays ready", async () => {
    const { ch, child } = makeChannel();
    child.ready();
    const p = ch.request("bad.method");
    child.emitFrame({ id: 1, ok: false, e: { code: "E_NO_METHOD", msg: "unknown" } });
    await expect(p).rejects.toThrow(/E_NO_METHOD/);
    expect(ch.getState()).toBe("ready");
  });

  it("times out a request and ignores the late reply", async () => {
    vi.useFakeTimers();
    try {
      const { ch, child } = makeChannel();
      child.ready();
      const p = ch.request("probe.ping", undefined, 1_000);
      const assertion = expect(p).rejects.toThrow(/E_TIMEOUT/);
      vi.advanceTimersByTime(1_100);
      await assertion;
      // A tombstoned id must not resolve anything, and must not throw.
      expect(() => child.emitFrame({ id: 1, ok: true, r: { pong: true } })).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards events but handles ready/fatal itself", () => {
    const { ch, child, events } = makeChannel();
    child.ready();
    child.emitFrame({ ev: "hb", p: { seq: 1 } });
    child.emitFrame({ ev: "sessions.changed", p: { n: 2 } });
    expect(events.map((e) => e[0])).toEqual(["hb", "sessions.changed"]);
    expect(ch.getState()).toBe("ready");
  });

  it("treats a fatal frame as a connection failure", () => {
    const { ch, child } = makeChannel();
    child.emitFrame({ ev: "fatal", p: { code: "nopython" } });
    expect(ch.getState()).toBe("backoff");
  });

  it("reconnects with backoff after a drop, and stops when closed", () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      let spawns = 0;
      const ch = new ProbeChannel(
        { machine: "test", spawnFn: () => { spawns++; return child as unknown as ChildProcessWithoutNullStreams; } },
        {},
      );
      ch.connect();
      expect(spawns).toBe(1);
      child.ready();

      child.emit("close", 1);
      expect(ch.getState()).toBe("backoff");
      vi.advanceTimersByTime(1_050);
      expect(spawns).toBe(2);

      ch.close();
      vi.advanceTimersByTime(120_000);
      expect(spawns).toBe(2); // no further attempts once closed
      expect(ch.getState()).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("walks the backoff ladder from its first rung", () => {
    vi.useFakeTimers();
    try {
      let spawns = 0;
      let child = new FakeChild();
      const ch = new ProbeChannel(
        { machine: "test", spawnFn: () => { spawns++; child = new FakeChild(); return child as unknown as ChildProcessWithoutNullStreams; } },
        {},
      );
      ch.connect();
      // Each failure is immediate, so the delay should be 1s, 2s, 5s, 10s… — not
      // 2s, 5s, … (indexing after the increment would silently skip the first rung).
      for (const expected of [1_000, 2_000, 5_000, 10_000]) {
        const before = spawns;
        child.emit("close", 255);
        vi.advanceTimersByTime(expected - 50);
        expect(spawns).toBe(before);          // not yet
        vi.advanceTimersByTime(100);
        expect(spawns).toBe(before + 1);      // and now
      }
      ch.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off hard when the connection flaps, to avoid tripping fail2ban", () => {
    vi.useFakeTimers();
    try {
      let spawns = 0;
      let child = new FakeChild();
      const ch = new ProbeChannel(
        { machine: "test", spawnFn: () => { spawns++; child = new FakeChild(); return child as unknown as ChildProcessWithoutNullStreams; } },
        {},
      );
      ch.connect();
      // Six failures that each die instantly. A burst of failed SSH handshakes is
      // exactly what fail2ban bans, so the ladder must abandon itself for the floor.
      // Advance by exactly each rung so every reconnect dies with ~0 uptime.
      for (const rung of [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]) {
        child.emit("close", 255);
        vi.advanceTimersByTime(rung);
      }
      const before = spawns;
      // The last close tripped the flap detector: a full minute must produce nothing.
      vi.advanceTimersByTime(120_000);
      expect(spawns).toBe(before);
      vi.advanceTimersByTime(200_000);
      expect(spawns).toBe(before + 1);
      ch.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
