import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../src/adapters/persistence/in-memory-session-store";
import type { AgentSession } from "@rcw/shared";

const base = (id: string): AgentSession => ({
  id, machine: "m1", cwd: "/repo", gitBranch: "main",
  attachedAt: new Date(), lastSeenAt: new Date(),
  wrapperId: "w1", permissionMode: "default", autoModeEnabled: false,
  latestAnswer: null, summary: null, todos: [], transcript: [], working: false, pinned: false, snoozedUntil: null,
});

describe("InMemorySessionStore rich state", () => {
  it("patchState updates only provided fields and preserves the rest", async () => {
    const store = new InMemorySessionStore();
    await store.upsert(base("s1"));
    const r1 = await store.patchState("s1", { latestAnswer: "done", todos: [{ text: "ship", status: "in_progress" }] });
    expect(r1?.latestAnswer).toBe("done");
    expect(r1?.todos).toEqual([{ text: "ship", status: "in_progress" }]);
    expect(r1?.summary).toBeNull();
    const r2 = await store.patchState("s1", { summary: "refactor in progress" });
    expect(r2?.summary).toBe("refactor in progress");
    expect(r2?.latestAnswer).toBe("done");
  });

  it("patchState sets transcript and preserves it across subsequent patches", async () => {
    const store = new InMemorySessionStore();
    await store.upsert(base("s3"));
    const msgs = [{ role: "user" as const, text: "hello" }, { role: "assistant" as const, text: "hi there" }];
    const r1 = await store.patchState("s3", { transcript: msgs });
    expect(r1?.transcript).toEqual(msgs);
    // patching other fields must not wipe transcript
    const r2 = await store.patchState("s3", { latestAnswer: "done" });
    expect(r2?.transcript).toEqual(msgs);
    // re-attach (upsert) must not wipe transcript
    await store.upsert(base("s3"));
    const r3 = await store.get("s3");
    expect(r3?.transcript).toEqual(msgs);
  });

  it("patchState toggles working and preserves it across a re-upsert (attach)", async () => {
    const store = new InMemorySessionStore();
    await store.upsert(base("s4"));
    expect((await store.get("s4"))?.working).toBe(false);
    const r1 = await store.patchState("s4", { working: true });
    expect(r1?.working).toBe(true);
    // a heartbeat/attach (upsert) must not reset working mid-turn
    await store.upsert(base("s4"));
    expect((await store.get("s4"))?.working).toBe(true);
    const r2 = await store.patchState("s4", { working: false });
    expect(r2?.working).toBe(false);
  });

  it("patchState returns null for an unknown id", async () => {
    const store = new InMemorySessionStore();
    expect(await store.patchState("nope", { summary: "x" })).toBeNull();
  });

  it("close() stamps closedAt and excludes the session from list()", async () => {
    const store = new InMemorySessionStore();
    await store.upsert(base("s1"));
    await store.upsert(base("s2"));
    const at = new Date();
    await store.close("s1", at);
    // still retrievable by id (history kept), but gone from the list
    const s1 = await store.get("s1");
    expect(s1?.closedAt?.getTime()).toBe(at.getTime());
    const ids = (await store.list()).map((s) => s.id);
    expect(ids).toEqual(["s2"]);
  });

  it("close() is idempotent — a second close keeps the original time", async () => {
    const store = new InMemorySessionStore();
    await store.upsert(base("s1"));
    const first = new Date(Date.now() - 10_000);
    await store.close("s1", first);
    await store.close("s1", new Date());
    expect((await store.get("s1"))?.closedAt?.getTime()).toBe(first.getTime());
  });

  it("setPinned / setSnoozedUntil persist and survive a re-upsert (heartbeat/attach)", async () => {
    const store = new InMemorySessionStore();
    await store.upsert(base("s1"));
    await store.setPinned("s1", true);
    const until = new Date(Date.now() + 60_000);
    await store.setSnoozedUntil("s1", until);
    await store.patchState("s1", { latestAnswer: "hi" });
    await store.upsert(base("s1"));
    const s = await store.get("s1");
    expect(s?.pinned).toBe(true);
    expect(s?.snoozedUntil?.getTime()).toBe(until.getTime());
    expect(s?.latestAnswer).toBe("hi");
  });
});
