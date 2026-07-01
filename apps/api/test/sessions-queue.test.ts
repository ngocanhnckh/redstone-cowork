import { describe, it, expect, vi } from "vitest";
import { SessionsService, sessionStatus } from "../src/application/sessions.service";
import { InMemorySessionStore } from "../src/adapters/persistence/in-memory-session-store";
import type { AgentSession } from "@rcw/shared";
import type { EventsBus } from "../src/application/events-bus";

describe("sessionStatus", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  const at = (secondsAgo: number): AgentSession =>
    ({ lastSeenAt: new Date(now.getTime() - secondsAgo * 1000) }) as AgentSession;

  it("fresh + pending → waiting; fresh, no pending → active", () => {
    expect(sessionStatus(at(5), 1, now)).toBe("waiting");
    expect(sessionStatus(at(5), 0, now)).toBe("active");
  });
  it("a long-silent session is lost even with pending cards (killed tmux/poller)", () => {
    expect(sessionStatus(at(60 * 60), 3, now)).toBe("lost"); // 1h silent, 3 pending → lost, not waiting
    expect(sessionStatus(at(60 * 60), 0, now)).toBe("lost");
  });
  it("between active and stale windows with no pending → stale", () => {
    expect(sessionStatus(at(120), 0, now)).toBe("stale"); // 2min, no pending
    expect(sessionStatus(at(120), 1, now)).toBe("waiting"); // still alive + pending
  });
});

const bus = () => ({ emit: vi.fn() }) as unknown as EventsBus;

async function seed(store: InMemorySessionStore, svc: SessionsService) {
  await svc.attach({ id: "s1", machine: "m", cwd: "/a", gitBranch: "main", wrapperId: "w1", permissionMode: "default", autoModeEnabled: false });
  await svc.attach({ id: "s2", machine: "m", cwd: "/b", gitBranch: "main", wrapperId: "w2", permissionMode: "default", autoModeEnabled: false });
  await svc.attach({ id: "s3", machine: "m", cwd: "/c", gitBranch: "main", wrapperId: "w3", permissionMode: "default", autoModeEnabled: false });
}

describe("SessionsService queue + state", () => {
  it("patchState stores fields and emits session.updated", async () => {
    const store = new InMemorySessionStore();
    const b = bus();
    const svc = new SessionsService(store, b);
    await seed(store, svc);
    const s = await svc.patchState("s1", { latestAnswer: "hi", summary: "doing x", todos: [{ text: "t", status: "pending" }] });
    expect(s?.latestAnswer).toBe("hi");
    expect(b.emit).toHaveBeenCalledWith({ type: "session.updated", payload: { id: "s1" } });
  });

  it("queue lists only waiting sessions, pinned first then longest-waiting first", async () => {
    const store = new InMemorySessionStore();
    const svc = new SessionsService(store, bus());
    await seed(store, svc);
    const now = new Date("2026-06-26T12:00:00Z");
    const pending = { s1: 1, s2: 1, s3: 1 };
    const oldest = {
      s1: new Date("2026-06-26T11:58:00Z"),
      s2: new Date("2026-06-26T11:50:00Z"),
      s3: new Date("2026-06-26T11:59:00Z"),
    };
    await svc.pin("s3", true);
    const q = await svc.queue(pending, oldest, now);
    expect(q.map((v) => v.id)).toEqual(["s3", "s2", "s1"]);
    expect(q[1].waitingSince?.getTime()).toBe(oldest.s2.getTime());
  });

  it("user todos: add appends, toggle flips done and floats undone to the top", async () => {
    const store = new InMemorySessionStore();
    const svc = new SessionsService(store, bus());
    await seed(store, svc);
    await svc.addUserTodo("s1", "first");
    await svc.addUserTodo("s1", "second");
    let s = await svc.get("s1");
    expect(s?.userTodos.map((t) => t.text)).toEqual(["first", "second"]);
    expect(s?.userTodos.every((t) => !t.done)).toBe(true);
    // Check off "first" → it should drop below the still-open "second".
    const firstId = s!.userTodos.find((t) => t.text === "first")!.id;
    s = await svc.toggleUserTodo("s1", firstId);
    expect(s?.userTodos.map((t) => t.text)).toEqual(["second", "first"]);
    expect(s?.userTodos.find((t) => t.text === "first")?.done).toBe(true);
    // Delete "second".
    const secondId = s!.userTodos.find((t) => t.text === "second")!.id;
    s = await svc.deleteUserTodo("s1", secondId);
    expect(s?.userTodos.map((t) => t.text)).toEqual(["first"]);
  });

  it("user-todo ops on an unknown session return null", async () => {
    const store = new InMemorySessionStore();
    const svc = new SessionsService(store, bus());
    expect(await svc.addUserTodo("nope", "x")).toBeNull();
    expect(await svc.toggleUserTodo("nope", "y")).toBeNull();
  });

  it("queue excludes a session snoozed past now but keeps it in listViews", async () => {
    const store = new InMemorySessionStore();
    const svc = new SessionsService(store, bus());
    await seed(store, svc);
    const now = new Date("2026-06-26T12:00:00Z");
    const pending = { s1: 1 };
    const oldest = { s1: new Date("2026-06-26T11:55:00Z") };
    await svc.snooze("s1", 15, now);
    const q = await svc.queue(pending, oldest, now);
    expect(q.find((v) => v.id === "s1")).toBeUndefined();
    const views = await svc.listViews(pending, oldest);
    expect(views.find((v) => v.id === "s1")?.waitingSince?.getTime()).toBe(oldest.s1.getTime());
  });
});
