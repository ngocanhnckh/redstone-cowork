import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ProbeChannel } from "./probe-channel";
import { SessionEngine } from "./session-engine";

// Opt-in end-to-end test: real host, real SSH, real Claude sessions, nothing installed.
//
//   RCW_PROBE_HOST=<host> pnpm --filter @rcw/desktop test session-engine.remote
//
// This is the claim of the whole offline edition, exercised against a live box.

const HOST = process.env.RCW_PROBE_HOST;
const maybe = HOST ? describe : describe.skip;

maybe(`SessionEngine (remote: ${HOST ?? "unset"})`, () => {
  let ch: ProbeChannel;
  let engine: SessionEngine;

  beforeAll(async () => {
    ch = new ProbeChannel({ machine: HOST!, ssh: { host: HOST!, opts: [] } }, {});
    ch.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("never ready")), 45_000);
      const tick = setInterval(() => {
        if (ch.getState() === "ready") { clearInterval(tick); clearTimeout(t); resolve(); }
        if (ch.getState() === "backoff") { clearInterval(tick); clearTimeout(t); reject(new Error(JSON.stringify(ch.getDiagnostics()))); }
      }, 50);
    });
    engine = new SessionEngine(ch, HOST!);
  }, 60_000);

  afterAll(() => { ch?.close(); });

  it("assembles real sessions from a host with no agent installed", async () => {
    const sessions = await engine.refresh();
    expect(Array.isArray(sessions)).toBe(true);

    console.log(`\n[${HOST}] ${sessions.length} session(s):`);
    for (const s of sessions.slice(0, 12)) {
      console.log(
        `  ${s.live ? "●" : "○"} ${s.status.padEnd(7)} ${(s.wrapperId ? `rcw-${s.wrapperId}` : s.paneTarget ?? "—").padEnd(22)}` +
        ` ${s.cwd.padEnd(34)} msgs=${String(s.transcript.length).padEnd(4)} tok=${s.tokensInput}/${s.tokensOutput}` +
        ` ctx=${s.contextTokens ?? "—"} model=${s.model ?? "—"}`,
      );
      if (s.summary) console.log(`      ↳ ${s.summary.slice(0, 100)}`);
    }

    for (const s of sessions) {
      expect(s.id).toMatch(/^[0-9a-f-]{8,}$/i);
      expect(s.cwd.startsWith("/")).toBe(true);
      expect(s.machine).toBe(HOST);
      // Token totals are cumulative-absolute — never negative, never partial.
      expect(s.tokensInput).toBeGreaterThanOrEqual(0);
      expect(s.tokensOutput).toBeGreaterThanOrEqual(0);
    }
  }, 180_000);

  it("recovers transcripts and metadata that only hooks provide in the hosted edition", async () => {
    const sessions = await engine.refresh();
    const withHistory = sessions.filter((s) => s.transcript.length > 0);
    expect(withHistory.length, "expected at least one session with readable history").toBeGreaterThan(0);

    const s = withHistory[0];
    expect(["user", "assistant"]).toContain(s.transcript[s.transcript.length - 1].role);
    // Summary comes from Claude Code's own ai-title/away_summary markers — the hosted
    // edition pays an LLM to generate this.
    expect(typeof s.summary === "string" || s.summary === null).toBe(true);
  }, 180_000);

  it("is cheap on the second pass — deltas, not re-reads", async () => {
    await engine.refresh();                    // warm: heads + full tails + reduces
    const t0 = Date.now();
    const again = await engine.refresh();      // hot: stat + deltas only
    const elapsed = Date.now() - t0;
    console.log(`[${HOST}] warm refresh: ${elapsed}ms for ${again.length} session(s)`);
    // Generous bound — this asserts "we aren't re-reading every transcript", not a
    // performance target, so it won't flake on a slow link.
    expect(elapsed).toBeLessThan(60_000);
  }, 300_000);
});
