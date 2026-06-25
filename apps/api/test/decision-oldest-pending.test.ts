import { describe, it, expect } from "vitest";
import { InMemoryDecisionStore } from "../src/adapters/persistence/in-memory-decision-store";
import type { Decision } from "@rcw/shared";

const dec = (id: string, sessionId: string, createdAt: Date, status: "pending" | "resolved" = "pending"): Decision => ({
  id, sessionId, kind: "question", title: id, body: {}, options: [],
  status, createdAt, resolvedAt: null, resolution: null, deliveredAt: null,
});

describe("InMemoryDecisionStore.oldestPendingAtBySession", () => {
  it("returns the earliest pending createdAt per session, ignoring resolved", async () => {
    const store = new InMemoryDecisionStore();
    const t1 = new Date("2026-06-26T10:00:00Z");
    const t2 = new Date("2026-06-26T10:05:00Z");
    const t3 = new Date("2026-06-26T10:02:00Z");
    await store.create(dec("a", "s1", t2));
    await store.create(dec("b", "s1", t1)); // earliest for s1
    await store.create(dec("c", "s2", t3, "resolved")); // ignored
    const out = await store.oldestPendingAtBySession();
    expect(out["s1"]?.getTime()).toBe(t1.getTime());
    expect(out["s2"]).toBeUndefined();
  });
});
