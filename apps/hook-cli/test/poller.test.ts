import { describe, it, expect, vi } from "vitest";
import { pollOnce } from "../src/poller";

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
