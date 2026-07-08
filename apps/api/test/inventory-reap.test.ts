import { describe, it, expect } from "vitest";
import type { AgentSession } from "@rcw/shared";
import { InventoryService } from "../src/application/inventory.service";
import { InMemoryInventoryStore } from "../src/adapters/persistence/in-memory-inventory-store";
import { InMemorySessionStore } from "../src/adapters/persistence/in-memory-session-store";
import { InventoryWaiters } from "../src/application/inventory-waiters";
import { EventsBus } from "../src/application/events-bus";

const OLD = new Date(Date.now() - 10 * 60_000); // well past the 2-min grace

// `lastSeenAt` defaults to OLD (gone quiet → reapable). A live session passes a
// recent lastSeenAt and must be protected from reaping.
const session = (id: string, machine: string, lastSeenAt: Date = OLD): AgentSession => ({
  id, machine, cwd: "/repo", gitBranch: "main",
  attachedAt: OLD, lastSeenAt,
  wrapperId: `w-${id}`, permissionMode: "default", autoModeEnabled: false,
  latestAnswer: null, summary: null, todos: [], userTodos: [], tags: [], transcript: [],
  working: false, contextTokens: null, model: null, tokensInput: 0, tokensOutput: 0,
  tokenSeries: [], pinned: false, snoozedUntil: null, closedAt: null,
});

const scan = (id: string) => ({ id, cwd: "/repo", title: null, lastActive: new Date(), messageCount: 1, sizeBytes: 10 });

const make = () => {
  const sessions = new InMemorySessionStore();
  const svc = new InventoryService(new InMemoryInventoryStore(), sessions, new InventoryWaiters(), new EventsBus());
  return { sessions, svc };
};

describe("inventory auto-reap reconciliation", () => {
  it("closes an attached session absent from the scan; keeps reported ones", async () => {
    const { sessions, svc } = make();
    await sessions.upsert(session("A", "mac"));
    await sessions.upsert(session("B", "mac"));
    await sessions.upsert(session("C", "mac")); // will be missing from scan → reaped

    await svc.reportInventory("h1", { machine: "mac", sessions: [scan("A"), scan("B")] });

    expect((await sessions.get("C"))?.closedAt).toBeTruthy();
    expect((await sessions.get("A"))?.closedAt).toBeNull();
    const listed = (await sessions.list()).map((s) => s.id).sort();
    expect(listed).toEqual(["A", "B"]);
  });

  it("never touches sessions on a different machine", async () => {
    const { sessions, svc } = make();
    await sessions.upsert(session("D", "other"));
    await svc.reportInventory("h1", { machine: "mac", sessions: [scan("A")] });
    expect((await sessions.get("D"))?.closedAt).toBeNull();
  });

  it("an empty scan closes nothing (guards against scan errors)", async () => {
    const { sessions, svc } = make();
    await sessions.upsert(session("C", "mac"));
    await svc.reportInventory("h1", { machine: "mac", sessions: [] });
    expect((await sessions.get("C"))?.closedAt).toBeNull();
  });

  it("does not reap a session seen within the grace window (just attached / heartbeating)", async () => {
    const { sessions, svc } = make();
    await sessions.upsert(session("young", "mac", new Date())); // seen just now
    await svc.reportInventory("h1", { machine: "mac", sessions: [scan("A")] });
    expect((await sessions.get("young"))?.closedAt).toBeNull();
  });

  it("keeps a LIVE session that's missing from the scan (recent heartbeat) — the disappears-after-1-min bug", async () => {
    const { sessions, svc } = make();
    // Attached long ago, but its poller still heartbeats (fresh lastSeenAt), and the
    // scan can't see its transcript (e.g. cwd hidden past the head window).
    await sessions.upsert(session("live", "mac", new Date(Date.now() - 20_000)));
    await svc.reportInventory("h1", { machine: "mac", sessions: [scan("A")] });
    expect((await sessions.get("live"))?.closedAt).toBeNull();
    expect((await sessions.list()).map((s) => s.id)).toContain("live");
  });
});
