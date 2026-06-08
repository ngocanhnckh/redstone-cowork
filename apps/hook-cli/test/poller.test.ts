import { describe, it, expect, vi } from "vitest";
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
