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

describe("inventory auto-reap reconciliation (heartbeat-based)", () => {
  it("reaps a dead-poller session even while its transcript is STILL scanned — the exited-session-still-showing bug", async () => {
    const { sessions, svc } = make();
    // Its tmux exited (Claude quit/crashed) so the poller is gone (lastSeenAt=OLD), but the
    // transcript survives on disk and is still reported by the scan. Must be reaped anyway.
    await sessions.upsert(session("dead", "mac")); // OLD lastSeenAt, present in scan
    await svc.reportInventory("h1", { machine: "mac", sessions: [scan("dead"), scan("alive")] });
    expect((await sessions.get("dead"))?.closedAt).toBeTruthy();
    expect((await sessions.list()).map((s) => s.id)).not.toContain("dead");
  });

  it("keeps a LIVE (recently-heartbeat) session whether or not the scan lists its transcript", async () => {
    const { sessions, svc } = make();
    await sessions.upsert(session("live_scanned", "mac", new Date(Date.now() - 20_000)));   // fresh + in scan
    await sessions.upsert(session("live_unscanned", "mac", new Date(Date.now() - 20_000))); // fresh + NOT in scan
    await svc.reportInventory("h1", { machine: "mac", sessions: [scan("live_scanned")] });
    expect((await sessions.get("live_scanned"))?.closedAt).toBeNull();
    expect((await sessions.get("live_unscanned"))?.closedAt).toBeNull(); // heartbeat protects it
  });

  it("reaps a stale session even on an empty scan (heartbeat, not transcript, is the liveness signal)", async () => {
    const { sessions, svc } = make();
    await sessions.upsert(session("dead", "mac"));                        // OLD → reaped
    await sessions.upsert(session("live", "mac", new Date()));            // fresh → kept
    await svc.reportInventory("h1", { machine: "mac", sessions: [] });
    expect((await sessions.get("dead"))?.closedAt).toBeTruthy();
    expect((await sessions.get("live"))?.closedAt).toBeNull();
  });

  it("never touches sessions on a different machine", async () => {
    const { sessions, svc } = make();
    await sessions.upsert(session("D", "other")); // OLD, but on another machine
    await svc.reportInventory("h1", { machine: "mac", sessions: [scan("A")] });
    expect((await sessions.get("D"))?.closedAt).toBeNull();
  });
});
