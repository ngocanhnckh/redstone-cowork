import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { ProbeChannel } from "./probe-channel";
import type { ProbeInfo } from "./probe-protocol";

// Integration test against a REAL python3 running the REAL probe, over the local
// (no-ssh) path. Nothing here is mocked: if the framing, bootstrap, correlation,
// streaming or shutdown handling is wrong, this fails.
//
// Skipped when python3 is absent, since that's exactly the case the offline edition
// falls back to reduced mode for.

let hasPython = false;
try {
  execFileSync("/bin/sh", ["-c", "command -v python3 || command -v python"], { stdio: "pipe" });
  hasPython = true;
} catch {
  hasPython = false;
}

const maybe = hasPython ? describe : describe.skip;

maybe("ProbeChannel (local, real python)", () => {
  let ch: ProbeChannel;
  let ready: ProbeInfo | null = null;
  const events: Array<{ name: string; payload: unknown }> = [];

  const waitReady = (c: ProbeChannel) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("probe never became ready")), 20_000);
      const tick = setInterval(() => {
        if (c.getState() === "ready") { clearInterval(tick); clearTimeout(t); resolve(); }
        if (c.getState() === "backoff") {
          clearInterval(tick); clearTimeout(t);
          reject(new Error(`channel failed: ${JSON.stringify(c.getDiagnostics())}`));
        }
      }, 25);
    });

  beforeAll(async () => {
    ch = new ProbeChannel(
      { machine: "localhost" },
      {
        onReady: (info) => { ready = info; },
        onEvent: (name, payload) => events.push({ name, payload }),
      },
    );
    ch.connect();
    await waitReady(ch);
  }, 30_000);

  afterAll(() => { ch?.close(); });

  it("completes the handshake and reports host capabilities", () => {
    expect(ch.getState()).toBe("ready");
    expect(ready).toBeTruthy();
    expect(ready!.proto).toBe(1);
    expect(ready!.py).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof ready!.caps.loadBufferStdin).toBe("boolean");
  });

  it("round-trips a request by id", async () => {
    const r = await ch.request<{ pong: boolean; t: number }>("probe.ping");
    expect(r.pong).toBe(true);
    expect(r.t).toBeGreaterThan(0);
  });

  it("correlates concurrent requests independently of completion order", async () => {
    // telemetry.sample is dispatched to a worker thread and is slower than ping, so
    // these resolve out of order — which is the whole point of id correlation.
    const [ping, tele] = await Promise.all([
      ch.request<{ pong: boolean }>("probe.ping"),
      ch.request<{ ramTotal: number }>("telemetry.sample"),
    ]);
    expect(ping.pong).toBe(true);
    expect(tele.ramTotal).toBeGreaterThan(0);
  });

  it("lists tmux panes, or reports the server as not running", async () => {
    const r = await ch.request<{ panes: unknown[]; running: boolean }>("tmux.list");
    expect(Array.isArray(r.panes)).toBe(true);
    expect(typeof r.running).toBe("boolean");
  });

  it("samples telemetry with a remote-side clock", async () => {
    const r = await ch.request<{ ramUsed: number; ramTotal: number; t: number; uptimeSec: number }>("telemetry.sample");
    expect(r.ramTotal).toBeGreaterThan(0);
    expect(r.ramUsed).toBeGreaterThan(0);
    expect(r.ramUsed).toBeLessThanOrEqual(r.ramTotal);
    // Ages must be computed from the probe's clock, never remote-mtime vs local now.
    expect(r.t).toBeGreaterThan(0);
    expect(r.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("surfaces a remote handler error as a rejection, keeping the channel alive", async () => {
    await expect(ch.request("nope.not.a.method")).rejects.toThrow(/E_NO_METHOD/);
    // The channel must survive a bad request — that's the whole invariant.
    expect(ch.getState()).toBe("ready");
    await expect(ch.request<{ pong: boolean }>("probe.ping")).resolves.toMatchObject({ pong: true });
  });

  it("reassembles a streamed response larger than the inline threshold", async () => {
    // capture-pane over a big scrollback exceeds STREAM_THRESHOLD, exercising the
    // chunked b64+zlib path. Any tmux target works; a missing one errors instead,
    // so only assert the stream path when tmux actually has a session.
    const list = await ch.request<{ panes: Array<{ session: string }>; running: boolean }>("tmux.list");
    if (!list.running || list.panes.length === 0) return;
    const target = list.panes[0].session;
    const r = await ch.request<{ text: string }>("tmux.capturePane", { target, lines: 4000 }, 30_000);
    expect(typeof r.text).toBe("string");
  }, 40_000);

  it("emits heartbeats so a dead peer is detectable", async () => {
    await new Promise((r) => setTimeout(r, 6_000));
    const hb = events.filter((e) => e.name === "hb");
    expect(hb.length).toBeGreaterThan(0);
    expect((hb[0].payload as { seq: number }).seq).toBeGreaterThan(0);
  }, 15_000);

  it("rejects in-flight requests when the channel closes", async () => {
    const solo = new ProbeChannel({ machine: "localhost" }, {});
    solo.connect();
    await waitReady(solo);
    const inflight = solo.request("telemetry.sample");
    solo.close();
    await expect(inflight).rejects.toThrow(/E_CHANNEL_CLOSED/);
    expect(solo.getState()).toBe("closed");
  }, 30_000);

  it("refuses requests before the handshake completes", async () => {
    const fresh = new ProbeChannel({ machine: "localhost" }, {});
    await expect(fresh.request("probe.ping")).rejects.toThrow(/E_NOT_READY/);
    fresh.close();
  });
});
