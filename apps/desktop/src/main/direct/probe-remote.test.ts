import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ProbeChannel } from "./probe-channel";
import type { ProbeInfo } from "./probe-protocol";

// Opt-in integration test against a REAL remote host over SSH.
//
//   RCW_PROBE_HOST=contabo2 pnpm --filter @rcw/desktop test probe-remote
//
// Skipped by default so CI and other developers aren't coupled to anyone's
// infrastructure. This is the test that proves the thing the offline edition
// actually claims: a host with NOTHING installed on it — no ~/.redstone, no agent,
// no daemon — can be inspected over a single SSH connection.
//
// Everything it does is read-only: list tmux panes, sample CPU/RAM, capture a pane.

const HOST = process.env.RCW_PROBE_HOST;
const maybe = HOST ? describe : describe.skip;

maybe(`ProbeChannel (remote: ${HOST ?? "unset"})`, () => {
  let ch: ProbeChannel;
  let info: ProbeInfo | null = null;

  beforeAll(async () => {
    ch = new ProbeChannel(
      { machine: HOST!, ssh: { host: HOST!, opts: [] } },
      { onReady: (i) => { info = i; } },
    );
    ch.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`never ready: ${JSON.stringify(ch.getDiagnostics())}`)), 45_000);
      const tick = setInterval(() => {
        if (ch.getState() === "ready") { clearInterval(tick); clearTimeout(t); resolve(); }
        if (ch.getState() === "backoff") {
          clearInterval(tick); clearTimeout(t);
          reject(new Error(`failed: ${JSON.stringify(ch.getDiagnostics())}`));
        }
      }, 50);
    });
  }, 60_000);

  afterAll(() => { ch?.close(); });

  it("hands the program over stdin and completes the handshake", () => {
    expect(info).toBeTruthy();
    expect(info!.proto).toBe(1);
    expect(info!.host).toBeTruthy();
    expect(info!.user).toBeTruthy();
  });

  it("does not need anything installed on the host", () => {
    // The probe reports its own view of the box; nothing here came from ~/.redstone.
    expect(info!.py).toMatch(/^3\.\d+\.\d+$/);
    expect(info!.home).toMatch(/^\//);
  });

  it("reads real host telemetry", async () => {
    const a = await ch.request<{ ramUsed: number; ramTotal: number; cpuPct: number | null; uptimeSec: number }>("telemetry.sample");
    expect(a.ramTotal).toBeGreaterThan(0);
    expect(a.ramUsed).toBeLessThanOrEqual(a.ramTotal);
    expect(a.uptimeSec).toBeGreaterThan(0);

    // CPU% and net throughput are DELTAS — they need two samples separated in time,
    // which is exactly why they can't come from a one-shot ssh command and why this
    // work moved onto a persistent channel.
    await new Promise((r) => setTimeout(r, 1_200));
    const b = await ch.request<{ cpuPct: number | null; netRxBps: number | null }>("telemetry.sample");
    if (info!.caps.proc) {
      expect(b.cpuPct).not.toBeNull();
      expect(b.cpuPct!).toBeGreaterThanOrEqual(0);
      expect(b.cpuPct!).toBeLessThanOrEqual(100);
      expect(b.netRxBps).not.toBeNull();
    }
  }, 30_000);

  it("enumerates tmux, including sessions the cockpit never launched", async () => {
    const r = await ch.request<{ panes: Array<{ session: string; cwd: string }>; running: boolean }>("tmux.list");
    expect(typeof r.running).toBe("boolean");
    for (const p of r.panes) {
      expect(typeof p.session).toBe("string");
      expect(p.cwd.startsWith("/")).toBe(true);
    }
  });

  it("keeps one connection alive across many requests", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => ch.request<{ pong: boolean }>("probe.ping")));
    expect(results.every((r) => r.pong)).toBe(true);
    expect(ch.getState()).toBe("ready");
  }, 30_000);

  it("reports no junk on a well-behaved host", () => {
    // A login banner or an rc file that prints on non-interactive shells lands here.
    // Not a failure (we tolerate it), but worth seeing in the output.
    const { junk } = ch.getDiagnostics();
    if (junk) console.warn(`[probe] non-JSON output from ${HOST}:\n${junk.slice(0, 500)}`);
    expect(ch.getState()).toBe("ready");
  });
});
