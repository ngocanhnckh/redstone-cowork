import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pollOnce, pasteSettleMs } from "../src/poller";

describe("pollOnce", () => {
  it("sends keys for each delivery and acks", async () => {
    const sent: string[][][] = [];
    const acked: string[] = [];
    const deps = {
      deliveries: vi.fn().mockResolvedValue([
        { id: "d1", kind: "instruction", options: [], resolution: { choice: null, answers: null, custom: "hello" } },
      ]),
      markDelivered: vi.fn().mockImplementation(async (id: string) => { acked.push(id); }),
      sendKeys: async (keys: string[]) => { sent.push([keys]); },
    };
    await pollOnce(deps);
    expect(sent.length).toBeGreaterThan(0);
    expect(acked).toEqual(["d1"]);
  });
  it("waits for the paste to settle before Enter on instruction deliveries", async () => {
    const order: string[] = [];
    const deps = {
      deliveries: vi.fn().mockResolvedValue([
        { id: "d3", kind: "instruction", options: [], resolution: { choice: null, answers: null, custom: "a very long multi-word command that wraps" } },
      ]),
      markDelivered: vi.fn(),
      sendKeys: async (keys: string[]) => { order.push(keys[0] === "-l" ? "paste" : keys[0]); },
      sleep: vi.fn().mockImplementation(async () => { order.push("sleep"); }),
    };
    await pollOnce(deps);
    // paste, then a settle delay, THEN Enter
    expect(order).toEqual(["paste", "sleep", "Enter"]);
    expect(deps.sleep).toHaveBeenCalledOnce();
  });

  it("scales settle delay with text length and caps it", () => {
    expect(pasteSettleMs("hi")).toBe(256);
    expect(pasteSettleMs("x".repeat(10_000))).toBe(1500);
  });

  describe("ssh-authorize", () => {
    let home: string;
    const realHome = process.env.HOME;
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), "rcw-ssh-"));
      process.env.HOME = home;
      // Keep address detection from hitting the network (fast + deterministic).
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    });
    afterEach(() => {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
      rmSync(home, { recursive: true, force: true });
      vi.unstubAllGlobals();
    });

    const sshDelivery = () => ({
      id: "ssh1",
      kind: "ssh-authorize",
      sessionId: "sess-x",
      options: [],
      resolution: null,
      body: { publicKey: "ssh-ed25519 AAAATESTKEY desktop@redstone" },
    });

    it("installs the key, posts the result, and does NOT tmux send-keys", async () => {
      const postSshResult = vi.fn().mockResolvedValue(undefined);
      const sendKeys = vi.fn();
      const markDelivered = vi.fn();
      await pollOnce({
        deliveries: vi.fn().mockResolvedValue([sshDelivery()]),
        markDelivered,
        sendKeys,
        postSshResult,
        // ipify is unreachable / slow in tests; that's fine — address falls back to null
      });
      expect(sendKeys).not.toHaveBeenCalled();
      expect(markDelivered).toHaveBeenCalledWith("ssh1");
      expect(postSshResult).toHaveBeenCalledOnce();
      const [sid, result] = postSshResult.mock.calls[0];
      expect(sid).toBe("sess-x");
      expect(result.ok).toBe(true);
      expect(typeof result.user).toBe("string");
      expect(result.port).toBe(22);

      const keyFile = join(home, ".ssh", "authorized_keys");
      expect(existsSync(keyFile)).toBe(true);
      const contents = readFileSync(keyFile, "utf8");
      expect(contents).toContain("ssh-ed25519 AAAATESTKEY desktop@redstone");
      // file perms 0600
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    });

    it("dedupes the key on a second run", async () => {
      const deps = () => ({
        deliveries: vi.fn().mockResolvedValue([sshDelivery()]),
        markDelivered: vi.fn(),
        sendKeys: vi.fn(),
        postSshResult: vi.fn().mockResolvedValue(undefined),
      });
      await pollOnce(deps());
      await pollOnce(deps());
      const keyFile = join(home, ".ssh", "authorized_keys");
      const contents = readFileSync(keyFile, "utf8");
      const occurrences = contents.split("ssh-ed25519 AAAATESTKEY desktop@redstone").length - 1;
      expect(occurrences).toBe(1);
    });
  });

  it("acks but does not send for skipped deliveries", async () => {
    const deps = {
      deliveries: vi.fn().mockResolvedValue([
        { id: "d2", kind: "question", options: [], resolution: { choice: null, answers: null, custom: "free" } },
      ]),
      markDelivered: vi.fn(),
      sendKeys: vi.fn(),
    };
    await pollOnce(deps);
    expect(deps.sendKeys).not.toHaveBeenCalled();
    expect(deps.markDelivered).toHaveBeenCalledWith("d2");
  });
});
