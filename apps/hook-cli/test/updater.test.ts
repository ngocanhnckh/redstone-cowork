import { describe, it, expect, vi } from "vitest";
import { runUpdate } from "../src/updater";

const cfg = () => ({ serverUrl: "https://cowork.example.com", token: "rcwd_x" });
const okFetch = (body: string) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(body) }) as unknown as typeof fetch;

describe("runUpdate", () => {
  it("downloads a cache-busted, no-store bundle and writes it", async () => {
    const big = "x".repeat(2000);
    const fetchImpl = okFetch(big);
    const write = vi.fn();
    const r = await runUpdate({ loadConfig: cfg, fetchImpl, write, now: () => 123 });
    expect(r.ok).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://cowork.example.com/install/redstone.js?t=123");
    expect((init as RequestInit).headers).toMatchObject({ "Cache-Control": "no-store" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("redstone.js"), big);
  });

  it("fails (and does not write) when not configured", async () => {
    const write = vi.fn();
    const r = await runUpdate({ loadConfig: () => null, write });
    expect(r.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("fails (and does not write) on a non-OK response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve("") }) as unknown as typeof fetch;
    const write = vi.fn();
    const r = await runUpdate({ loadConfig: cfg, fetchImpl, write });
    expect(r.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects a suspiciously tiny body without overwriting the installed bundle", async () => {
    const write = vi.fn();
    const r = await runUpdate({ loadConfig: cfg, fetchImpl: okFetch("oops"), write });
    expect(r.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
