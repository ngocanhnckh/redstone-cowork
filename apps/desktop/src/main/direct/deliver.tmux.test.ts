import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { ProbeChannel } from "./probe-channel";
import { buildDeliverySteps } from "./deliver";

// Delivery against a REAL tmux pane, over the real probe channel.
//
// Uses a throwaway session running `cat` — never an actual Claude session, since
// keystrokes sent to one would land in someone's live work. `cat` echoes whatever it
// receives, which is exactly what makes "did the text arrive, and did Enter submit it"
// observable.

function tmuxAvailable(): boolean {
  try { execFileSync("tmux", ["-V"], { stdio: "pipe" }); return true; } catch { return false; }
}
function pythonAvailable(): boolean {
  try { execFileSync("/bin/sh", ["-c", "command -v python3 || command -v python"], { stdio: "pipe" }); return true; } catch { return false; }
}

const SESSION = `rcw-delivertest-${process.pid}`;
const maybe = tmuxAvailable() && pythonAvailable() ? describe : describe.skip;

maybe("tmux delivery (local, real tmux)", () => {
  let ch: ProbeChannel;

  const capture = async (): Promise<string> =>
    (await ch.request<{ text: string }>("tmux.capturePane", { target: `${SESSION}:0.0`, lines: 60 })).text;

  const deliverSteps = (steps: unknown[]) =>
    ch.request<{ ok: boolean; steps: { ok: boolean; err: string | null }[] }>(
      "tmux.deliver", { target: `${SESSION}:0.0`, steps }, 60_000,
    );

  beforeAll(async () => {
    execFileSync("tmux", ["new-session", "-d", "-s", SESSION, "cat"]);
    ch = new ProbeChannel({ machine: "localhost" }, {});
    ch.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("probe never ready")), 25_000);
      const tick = setInterval(() => {
        if (ch.getState() === "ready") { clearInterval(tick); clearTimeout(t); resolve(); }
      }, 25);
    });
  }, 40_000);

  afterAll(() => {
    ch?.close();
    try { execFileSync("tmux", ["kill-session", "-t", SESSION], { stdio: "pipe" }); } catch { /* already gone */ }
  });

  it("delivers text by bracketed paste and submits it with Enter", async () => {
    const caps = ch.getInfo()!.caps;
    const marker = `hello-from-the-probe-${Date.now()}`;
    const steps = buildDeliverySteps([["-l", marker], ["Enter"]], caps);
    // On modern tmux this must be a paste, not send-keys — that's the reliable path.
    if (caps.loadBufferStdin) expect(steps[0].paste).toBe(marker);

    const res = await deliverSteps(steps);
    expect(res.ok, JSON.stringify(res.steps)).toBe(true);

    await new Promise((r) => setTimeout(r, 400));
    const pane = await capture();
    // `cat` echoes the line back once Enter submits it, so seeing it twice proves both
    // that the text arrived AND that the Enter actually submitted.
    expect(pane).toContain(marker);
    expect(pane.split(marker).length - 1).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("delivers text containing shell metacharacters verbatim", async () => {
    // Quoting bugs are the classic failure here: this must arrive unmangled.
    const nasty = `rm -rf 'x'; echo "$HOME" && ls | wc -l ${"`"}date${"`"} \\$notavar`;
    const res = await deliverSteps(buildDeliverySteps([["-l", nasty], ["Enter"]], ch.getInfo()!.caps));
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(await capture()).toContain(nasty);
  }, 60_000);

  it("delivers text starting with a dash without tmux parsing it as a flag", async () => {
    // send-keys needs `--` before literal text, or "-l" style input becomes a flag.
    const dashed = "--dangerously-skip-permissions is not a flag here";
    const res = await deliverSteps(buildDeliverySteps([["-l", dashed], ["Enter"]], ch.getInfo()!.caps));
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(await capture()).toContain(dashed);
  }, 60_000);

  it("delivers a long multi-chunk payload intact on the legacy path", async () => {
    // Force the chunked send-keys fallback even on modern tmux, so the path used by
    // tmux < 3.0 is actually exercised rather than assumed.
    const long = Array.from({ length: 40 }, (_, i) => `line-${i}-${"y".repeat(30)}`).join(" ");
    const steps = buildDeliverySteps([["-l", long], ["Enter"]], { loadBufferStdin: false });
    expect(steps.filter((s) => s.k?.[0] === "-l").length).toBeGreaterThan(1);
    const res = await deliverSteps(steps);
    expect(res.ok, JSON.stringify(res.steps)).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(await capture()).toContain(long.slice(0, 120));
  }, 90_000);

  it("stops at the first failed step instead of submitting half-typed input", async () => {
    // `-Z` is an unknown send-keys flag, so tmux exits non-zero. (An unrecognised KEY
    // name doesn't fail — tmux sends it as literal text — so it can't be used here.)
    const res = await ch.request<{ ok: boolean; steps: { ok: boolean; err: string | null }[] }>(
      "tmux.deliver",
      { target: `${SESSION}:0.0`, steps: [{ k: ["-l", "partial"] }, { k: ["-Z"] }, { k: ["Enter"] }] },
      30_000,
    );
    expect(res.ok).toBe(false);
    // Third step must never run: an Enter after a broken step would submit garbage.
    expect(res.steps).toHaveLength(2);
    expect(res.steps[1].ok).toBe(false);
    expect(res.steps[1].err).toBeTruthy();
  }, 30_000);

  it("reports a bad pane target rather than failing silently", async () => {
    const res = await ch.request<{ ok: boolean; steps: { ok: boolean; err: string | null }[] }>(
      "tmux.deliver", { target: "rcw-no-such-session:0.0", steps: [{ k: ["Enter"] }] }, 30_000,
    );
    expect(res.ok).toBe(false);
    expect(res.steps[0].err).toBeTruthy();
  }, 30_000);
});
