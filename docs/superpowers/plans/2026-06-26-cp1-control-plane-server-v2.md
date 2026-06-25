# CP1 — Control-Plane Server v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing session/decision backbone so the desktop "Focus Theater" cockpit can render a live, ordered **waiting queue** with per-session **latest answer, rolling summary, and todo checklist**, plus **snooze/pin**.

**Architecture:** Purely additive to the running hexagonal API (`apps/api`). The session model gains rich state fields the agent host pushes via a new `POST /sessions/:id/state`; the waiting queue is a derived projection (sessions with pending decisions, ordered by when they began waiting); snooze/pin are per-session flags. No new subsystems — we extend ports, the in-memory + Postgres stores, the `SessionsService`, and the HTTP/SSE surface. All logic is unit/e2e-testable with in-memory stores (no DB needed for tests).

**Tech Stack:** TypeScript, NestJS, Zod v3 (`@rcw/shared`, ESM), Vitest + supertest, Postgres (idempotent SQL migrations run on container start).

## Global Constraints

- Node 22; pnpm + Turborepo workspace. Run API tests with `pnpm --filter @rcw/api exec vitest run`.
- Hexagonal: domain core (`domain/**`) stays framework-free; ports are `Symbol` tokens; adapters in `adapters/{http,persistence}`; composition root is `app.module.ts` (Postgres when `DATABASE_URL` set, in-memory otherwise — tests run in-memory).
- Shared types live once in `packages/shared` (Zod v3, ESM); rebuild with `pnpm --filter @rcw/shared build` before API typechecks see them.
- Conventional commits (`feat(api): …`). End every commit message with the line `Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R`.
- Never run Docker on the Mac; Postgres parity is verified via `deploy/remote.sh` on the dev server, not in unit tests.
- Existing status enum stays `["active","waiting","stale","lost"]`; a session is `waiting` iff it has ≥1 pending decision (this already works — do not change it).

---

### Task 1: Session rich-state in the shared schema + in-memory store

**Files:**
- Modify: `packages/shared/src/sessions/agent-session.ts`
- Modify: `apps/api/src/domain/sessions/session-store.port.ts`
- Modify: `apps/api/src/adapters/persistence/in-memory-session-store.ts`
- Test: `apps/api/test/session-store-state.test.ts` (create)

**Interfaces:**
- Produces:
  - `TodoItem = { text: string; status: "pending"|"in_progress"|"completed" }`
  - `SessionStatePatch = { latestAnswer?: string|null; summary?: string|null; todos?: TodoItem[] }`
  - `AgentSession` gains `latestAnswer: string|null`, `summary: string|null`, `todos: TodoItem[]`, `pinned: boolean`, `snoozedUntil: Date|null`
  - `SessionStore.patchState(id: string, patch: SessionStatePatch): Promise<AgentSession|null>` (null = unknown id)
  - `SessionStore.setPinned(id: string, pinned: boolean): Promise<void>`
  - `SessionStore.setSnoozedUntil(id: string, until: Date|null): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/session-store-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../src/adapters/persistence/in-memory-session-store";
import type { AgentSession } from "@rcw/shared";

const base = (id: string): AgentSession => ({
  id, machine: "m1", cwd: "/repo", gitBranch: "main",
  attachedAt: new Date(), lastSeenAt: new Date(),
  wrapperId: "w1", permissionMode: "default", autoModeEnabled: false,
  latestAnswer: null, summary: null, todos: [], pinned: false, snoozedUntil: null,
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
    expect(r2?.latestAnswer).toBe("done"); // preserved
  });

  it("patchState returns null for an unknown id", async () => {
    const store = new InMemorySessionStore();
    expect(await store.patchState("nope", { summary: "x" })).toBeNull();
  });

  it("setPinned / setSnoozedUntil persist and survive a re-upsert (heartbeat/attach)", async () => {
    const store = new InMemorySessionStore();
    await store.upsert(base("s1"));
    await store.setPinned("s1", true);
    const until = new Date(Date.now() + 60_000);
    await store.setSnoozedUntil("s1", until);
    await store.patchState("s1", { latestAnswer: "hi" });
    // a re-attach must NOT wipe managed state
    await store.upsert(base("s1"));
    const s = await store.get("s1");
    expect(s?.pinned).toBe(true);
    expect(s?.snoozedUntil?.getTime()).toBe(until.getTime());
    expect(s?.latestAnswer).toBe("hi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rcw/api exec vitest run test/session-store-state.test.ts`
Expected: FAIL — `patchState`/`setPinned`/`setSnoozedUntil` not on `InMemorySessionStore`, and `AgentSession` missing fields (type error / runtime undefined).

- [ ] **Step 3: Extend the shared schema**

In `packages/shared/src/sessions/agent-session.ts`, add the todo + patch schemas and extend `AgentSessionSchema`:

```ts
export const TodoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export const TodoItemSchema = z.object({
  text: z.string().min(1),
  status: TodoStatusSchema.default("pending"),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const SessionStatePatchSchema = z
  .object({
    latestAnswer: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    todos: z.array(TodoItemSchema).optional(),
  })
  .strict();
export type SessionStatePatch = z.infer<typeof SessionStatePatchSchema>;
```

Add these five fields to `AgentSessionSchema` (after `autoModeEnabled`):

```ts
  latestAnswer: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  todos: z.array(TodoItemSchema).default([]),
  pinned: z.boolean().default(false),
  snoozedUntil: z.coerce.date().nullable().default(null),
```

- [ ] **Step 4: Extend the store port**

In `apps/api/src/domain/sessions/session-store.port.ts`, import the patch type and add three methods:

```ts
import type { AgentSession, SessionStatePatch } from "@rcw/shared";

export interface SessionStore {
  upsert(session: AgentSession): Promise<AgentSession>;
  touch(id: string, at: Date): Promise<boolean>;
  get(id: string): Promise<AgentSession | null>;
  list(): Promise<AgentSession[]>;
  getByWrapper(wrapperId: string): Promise<AgentSession | null>;
  setPermissionMode(id: string, mode: string): Promise<void>;
  patchState(id: string, patch: SessionStatePatch): Promise<AgentSession | null>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setSnoozedUntil(id: string, until: Date | null): Promise<void>;
}
```

- [ ] **Step 5: Implement in the in-memory store**

In `apps/api/src/adapters/persistence/in-memory-session-store.ts`: (a) preserve managed state in `upsert`'s merge so a heartbeat/attach never wipes it, and (b) add the three methods. Replace the `merged` expression and append the methods:

```ts
import type { AgentSession, SessionStatePatch } from "@rcw/shared";
import type { SessionStore } from "../../domain/sessions/session-store.port";

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, AgentSession>();
  async upsert(s: AgentSession) {
    const existing = this.sessions.get(s.id);
    const merged = existing
      ? {
          ...existing,
          ...s,
          attachedAt: existing.attachedAt,
          permissionMode: s.permissionMode ?? existing.permissionMode,
          // managed only via patchState/setPinned/setSnoozedUntil — never reset by attach/heartbeat
          latestAnswer: existing.latestAnswer,
          summary: existing.summary,
          todos: existing.todos,
          pinned: existing.pinned,
          snoozedUntil: existing.snoozedUntil,
        }
      : s;
    this.sessions.set(s.id, merged);
    return merged;
  }
  async touch(id: string, at: Date) {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.lastSeenAt = at;
    return true;
  }
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async list() { return [...this.sessions.values()]; }
  async getByWrapper(wrapperId: string): Promise<AgentSession | null> {
    const matches = [...this.sessions.values()]
      .filter((s) => s.wrapperId === wrapperId)
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    return matches[0] ?? null;
  }
  async setPermissionMode(id: string, mode: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, permissionMode: mode });
  }
  async patchState(id: string, patch: SessionStatePatch): Promise<AgentSession | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const next: AgentSession = {
      ...s,
      ...(patch.latestAnswer !== undefined ? { latestAnswer: patch.latestAnswer } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.todos !== undefined ? { todos: patch.todos } : {}),
    };
    this.sessions.set(id, next);
    return next;
  }
  async setPinned(id: string, pinned: boolean): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, pinned });
  }
  async setSnoozedUntil(id: string, until: Date | null): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, snoozedUntil: until });
  }
}
```

- [ ] **Step 6: Build shared, run tests**

Run: `pnpm --filter @rcw/shared build && pnpm --filter @rcw/api exec vitest run test/session-store-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sessions/agent-session.ts apps/api/src/domain/sessions/session-store.port.ts apps/api/src/adapters/persistence/in-memory-session-store.ts apps/api/test/session-store-state.test.ts
git commit -m "feat(api): session rich-state (latestAnswer/summary/todos/pinned/snoozedUntil) in store

Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R"
```

---

### Task 2: `oldestPendingAtBySession` on the decision store (for waitingSince)

**Files:**
- Modify: `apps/api/src/domain/decisions/decision-store.port.ts`
- Modify: `apps/api/src/adapters/persistence/in-memory-decision-store.ts`
- Test: `apps/api/test/decision-oldest-pending.test.ts` (create)

**Interfaces:**
- Consumes: `Decision` (has `sessionId`, `status`, `createdAt`).
- Produces: `DecisionStore.oldestPendingAtBySession(): Promise<Record<string, Date>>` — for each session with pending decisions, the earliest `createdAt` among them (when the session began waiting).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/decision-oldest-pending.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rcw/api exec vitest run test/decision-oldest-pending.test.ts`
Expected: FAIL — `oldestPendingAtBySession` is not a function.

- [ ] **Step 3: Add to the port**

In `apps/api/src/domain/decisions/decision-store.port.ts`, add after `countPendingBySession`:

```ts
  /** For each session with pending decisions, the earliest pending createdAt (when it began waiting). */
  oldestPendingAtBySession(): Promise<Record<string, Date>>;
```

- [ ] **Step 4: Implement in the in-memory store**

In `apps/api/src/adapters/persistence/in-memory-decision-store.ts`, add after `countPendingBySession`:

```ts
  async oldestPendingAtBySession() {
    const oldest: Record<string, Date> = {};
    for (const d of this.decisions.values()) {
      if (d.status !== "pending") continue;
      const cur = oldest[d.sessionId];
      if (!cur || d.createdAt.getTime() < cur.getTime()) oldest[d.sessionId] = d.createdAt;
    }
    return oldest;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rcw/api exec vitest run test/decision-oldest-pending.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/domain/decisions/decision-store.port.ts apps/api/src/adapters/persistence/in-memory-decision-store.ts apps/api/test/decision-oldest-pending.test.ts
git commit -m "feat(api): DecisionStore.oldestPendingAtBySession for waitingSince

Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R"
```

---

### Task 3: SessionsService — state patch, waitingSince views, queue, snooze/pin

**Files:**
- Modify: `apps/api/src/application/sessions.service.ts`
- Test: `apps/api/test/sessions-queue.test.ts` (create)

**Interfaces:**
- Consumes: `SessionStore.patchState/setPinned/setSnoozedUntil` (Task 1), `DecisionStore.oldestPendingAtBySession` (Task 2).
- Produces:
  - `SessionView = AgentSession & { status; pendingDecisions: number; waitingSince: Date|null }`
  - `SessionsService.patchState(id, patch): Promise<AgentSession|null>` — patches + emits `session.updated`
  - `SessionsService.listViews(pendingBySession, oldestPendingAt): Promise<SessionView[]>`
  - `SessionsService.queue(pendingBySession, oldestPendingAt, now?): Promise<SessionView[]>` — waiting, not-currently-snoozed, ordered `(pinned desc, waitingSince asc)`
  - `SessionsService.snooze(id, minutes, now?): Promise<void>` · `SessionsService.pin(id, pinned): Promise<void>`
  - `attach` initializes the new fields to their defaults.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/sessions-queue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { SessionsService } from "../src/application/sessions.service";
import { InMemorySessionStore } from "../src/adapters/persistence/in-memory-session-store";
import type { EventsBus } from "../src/application/events-bus";

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
      s1: new Date("2026-06-26T11:58:00Z"), // 2m
      s2: new Date("2026-06-26T11:50:00Z"), // 10m  -> longest
      s3: new Date("2026-06-26T11:59:00Z"), // 1m
    };
    await svc.pin("s3", true);
    const q = await svc.queue(pending, oldest, now);
    expect(q.map((v) => v.id)).toEqual(["s3", "s2", "s1"]); // pinned, then 10m, then 2m
    expect(q[1].waitingSince?.getTime()).toBe(oldest.s2.getTime());
  });

  it("queue excludes a session snoozed past now but keeps it in listViews", async () => {
    const store = new InMemorySessionStore();
    const svc = new SessionsService(store, bus());
    await seed(store, svc);
    const now = new Date("2026-06-26T12:00:00Z");
    const pending = { s1: 1 };
    const oldest = { s1: new Date("2026-06-26T11:55:00Z") };
    await svc.snooze("s1", 15, now); // snoozed until 12:15
    const q = await svc.queue(pending, oldest, now);
    expect(q.find((v) => v.id === "s1")).toBeUndefined();
    const views = await svc.listViews(pending, oldest);
    expect(views.find((v) => v.id === "s1")?.waitingSince?.getTime()).toBe(oldest.s1.getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rcw/api exec vitest run test/sessions-queue.test.ts`
Expected: FAIL — `patchState`/`queue`/`snooze`/`pin` not on `SessionsService`; `listViews` arity mismatch.

- [ ] **Step 3: Implement the service changes**

Replace the body of `apps/api/src/application/sessions.service.ts` with:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { NewAgentSessionSchema, SessionStatePatchSchema, type AgentSession, type SessionStatePatch, type SessionStatus } from "@rcw/shared";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";
import { EventsBus } from "./events-bus";

export type SessionView = AgentSession & { status: SessionStatus; pendingDecisions: number; waitingSince: Date | null };

const ACTIVE_MS = 90_000;
const STALE_MS = 300_000;

export const sessionStatus = (s: AgentSession, pending: number, now: Date): SessionStatus => {
  if (pending > 0) return "waiting";
  const age = now.getTime() - s.lastSeenAt.getTime();
  if (age < ACTIVE_MS) return "active";
  if (age < STALE_MS) return "stale";
  return "lost";
};

@Injectable()
export class SessionsService {
  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    private readonly bus: EventsBus,
  ) {}

  async attach(input: unknown): Promise<AgentSession> {
    const parsed = NewAgentSessionSchema.parse(input);
    const now = new Date();
    const session = await this.store.upsert({
      ...parsed,
      attachedAt: now,
      lastSeenAt: now,
      permissionMode: parsed.permissionMode ?? null,
      autoModeEnabled: parsed.autoModeEnabled ?? false,
      latestAnswer: null,
      summary: null,
      todos: [],
      pinned: false,
      snoozedUntil: null,
    });
    this.bus.emit({ type: "session.updated", payload: { id: session.id } });
    return session;
  }

  async heartbeat(id: string): Promise<boolean> {
    const ok = await this.store.touch(id, new Date());
    if (ok) this.bus.emit({ type: "session.updated", payload: { id } });
    return ok;
  }

  async patchState(id: string, input: unknown): Promise<AgentSession | null> {
    const patch: SessionStatePatch = SessionStatePatchSchema.parse(input);
    const updated = await this.store.patchState(id, patch);
    if (updated) this.bus.emit({ type: "session.updated", payload: { id } });
    return updated;
  }

  async snooze(id: string, minutes: number, now = new Date()): Promise<void> {
    const until = new Date(now.getTime() + Math.max(0, minutes) * 60_000);
    await this.store.setSnoozedUntil(id, until);
    this.bus.emit({ type: "session.updated", payload: { id } });
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    await this.store.setPinned(id, pinned);
    this.bus.emit({ type: "session.updated", payload: { id } });
  }

  private toView(s: AgentSession, pending: number, oldestPendingAt: Record<string, Date>, now: Date): SessionView {
    return {
      ...s,
      pendingDecisions: pending,
      status: sessionStatus(s, pending, now),
      waitingSince: oldestPendingAt[s.id] ?? null,
    };
  }

  async listViews(pendingBySession: Record<string, number>, oldestPendingAt: Record<string, Date>): Promise<SessionView[]> {
    const now = new Date();
    return (await this.store.list()).map((s) => this.toView(s, pendingBySession[s.id] ?? 0, oldestPendingAt, now));
  }

  async queue(pendingBySession: Record<string, number>, oldestPendingAt: Record<string, Date>, now = new Date()): Promise<SessionView[]> {
    const views = (await this.store.list())
      .map((s) => this.toView(s, pendingBySession[s.id] ?? 0, oldestPendingAt, now))
      .filter((v) => v.status === "waiting")
      .filter((v) => !v.snoozedUntil || v.snoozedUntil.getTime() <= now.getTime());
    return views.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aw = a.waitingSince?.getTime() ?? 0;
      const bw = b.waitingSince?.getTime() ?? 0;
      return aw - bw; // longest-waiting (earliest) first
    });
  }

  get(id: string) { return this.store.get(id); }
  getByWrapper(wrapperId: string) { return this.store.getByWrapper(wrapperId); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rcw/api exec vitest run test/sessions-queue.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Fix the existing sessions controller call site**

`apps/api/src/adapters/http/sessions.controller.ts` calls `listViews(await this.decisions.countPendingBySession())` (one arg). Update its `list()` to pass both maps (full controller change lands in Task 4; for now just keep the build green):

```ts
  @Get()
  async list() {
    const [pending, oldest] = await Promise.all([
      this.decisions.countPendingBySession(),
      this.decisions.oldestPendingAtBySession(),
    ]);
    return this.sessions.listViews(pending, oldest);
  }
```

Add the passthrough to `DecisionsService` in `apps/api/src/application/decisions.service.ts` (after `countPendingBySession()`):

```ts
  oldestPendingAtBySession() { return this.store.oldestPendingAtBySession(); }
```

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm --filter @rcw/shared build && pnpm --filter @rcw/api exec tsc --noEmit && pnpm --filter @rcw/api exec vitest run`
Expected: typecheck exit 0; all tests pass (existing + new).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/application/sessions.service.ts apps/api/src/application/decisions.service.ts apps/api/src/adapters/http/sessions.controller.ts apps/api/test/sessions-queue.test.ts
git commit -m "feat(api): waiting queue + state patch + snooze/pin in SessionsService

Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R"
```

---

### Task 4: HTTP surface — state push, queue, snooze, pin (e2e)

**Files:**
- Modify: `apps/api/src/adapters/http/sessions.controller.ts`
- Test: `apps/api/test/sessions-queue.e2e.test.ts` (create)

**Interfaces:**
- Consumes: `SessionsService.patchState/queue/snooze/pin`, `DecisionsService.create/countPendingBySession/oldestPendingAtBySession`.
- Produces HTTP routes (all behind `InstanceTokenGuard`):
  - `POST /sessions/:id/state` body `{ latestAnswer?, summary?, todos? }` → updated session (404 unknown id)
  - `GET /sessions/queue` → `SessionView[]` (ordered)
  - `POST /sessions/:id/snooze` body `{ minutes: number }` → `{ ok: true }`
  - `POST /sessions/:id/pin` body `{ pinned: boolean }` → `{ ok: true }`
  - **Route order:** `queue` is a static segment and MUST be declared before any `:id` route (mirror the existing `by-wrapper` comment).

- [ ] **Step 1: Write the failing e2e test**

Create `apps/api/test/sessions-queue.e2e.test.ts`. Match the bootstrap of the existing `apps/api/test/sessions.e2e.test.ts` (same `INSTANCE_TOKEN` env + Authorization header pattern — read that file first and reuse its exact setup). The behavioral assertions to add:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TOKEN = "test-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("sessions queue + state HTTP", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  const attach = (id: string) =>
    auth(request(app.getHttpServer()).post("/sessions")).send({
      id, machine: "m", cwd: "/r", gitBranch: "main", wrapperId: "w-" + id, permissionMode: "default", autoModeEnabled: false,
    });

  it("pushes state and reads it back via the session list", async () => {
    await attach("s1").expect(201);
    await auth(request(app.getHttpServer()).post("/sessions/s1/state"))
      .send({ latestAnswer: "all done", summary: "stage 2", todos: [{ text: "ship", status: "in_progress" }] })
      .expect(201);
    const list = await auth(request(app.getHttpServer()).get("/sessions")).expect(200);
    const s1 = list.body.find((s: { id: string }) => s.id === "s1");
    expect(s1.latestAnswer).toBe("all done");
    expect(s1.todos[0].text).toBe("ship");
  });

  it("a session with a pending decision shows in /sessions/queue with waitingSince", async () => {
    await attach("s2").expect(201);
    await auth(request(app.getHttpServer()).post("/decisions"))
      .send({ sessionId: "s2", kind: "question", title: "approve?", options: [{ label: "yes" }] })
      .expect(201);
    const q = await auth(request(app.getHttpServer()).get("/sessions/queue")).expect(200);
    const s2 = q.body.find((v: { id: string }) => v.id === "s2");
    expect(s2).toBeTruthy();
    expect(s2.waitingSince).toBeTruthy();
  });

  it("pin and snooze respond ok", async () => {
    await auth(request(app.getHttpServer()).post("/sessions/s2/pin")).send({ pinned: true }).expect(200);
    await auth(request(app.getHttpServer()).post("/sessions/s2/snooze")).send({ minutes: 15 }).expect(200);
  });

  it("state on an unknown session 404s", async () => {
    await auth(request(app.getHttpServer()).post("/sessions/nope/state")).send({ summary: "x" }).expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rcw/api exec vitest run test/sessions-queue.e2e.test.ts`
Expected: FAIL — routes `/sessions/queue`, `/sessions/:id/state|snooze|pin` return 404.

- [ ] **Step 3: Add the routes**

In `apps/api/src/adapters/http/sessions.controller.ts`, add imports for `NotFoundException` (already imported) and `z`/`ZodError` (already imported). Insert the static `queue` route **before** the `:id` routes (next to `by-wrapper`), and add the three `:id` routes:

```ts
  // NOTE: static segments (queue) must be declared BEFORE :id routes
  @Get("queue")
  async queue() {
    const [pending, oldest] = await Promise.all([
      this.decisions.countPendingBySession(),
      this.decisions.oldestPendingAtBySession(),
    ]);
    return this.sessions.queue(pending, oldest);
  }

  @Post(":id/state")
  @HttpCode(201)
  async patchState(@Param("id") id: string, @Body() body: unknown) {
    try {
      const updated = await this.sessions.patchState(id, body);
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/snooze")
  @HttpCode(200)
  async snooze(@Param("id") id: string, @Body() body: unknown) {
    const { minutes } = z.object({ minutes: z.number().nonnegative() }).parse(body);
    if (!(await this.sessions.get(id))) throw new NotFoundException();
    await this.sessions.snooze(id, minutes);
    return { ok: true };
  }

  @Post(":id/pin")
  @HttpCode(200)
  async pin(@Param("id") id: string, @Body() body: unknown) {
    const { pinned } = z.object({ pinned: z.boolean() }).parse(body);
    if (!(await this.sessions.get(id))) throw new NotFoundException();
    await this.sessions.pin(id, pinned);
    return { ok: true };
  }
```

- [ ] **Step 4: Run the e2e + full suite**

Run: `pnpm --filter @rcw/api exec vitest run`
Expected: PASS (all suites, including the 4 new e2e cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/adapters/http/sessions.controller.ts apps/api/test/sessions-queue.e2e.test.ts
git commit -m "feat(api): /sessions/queue + state/snooze/pin endpoints

Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R"
```

---

### Task 5: Postgres parity + migration

**Files:**
- Create: `apps/api/migrations/<NNN>_session_state.sql` (use the next number after the highest existing migration)
- Modify: `apps/api/src/adapters/persistence/postgres-session-store.ts`
- Modify: `apps/api/src/adapters/persistence/postgres-decision-store.ts`

**Interfaces:**
- Produces the same `patchState/setPinned/setSnoozedUntil` and `oldestPendingAtBySession` behavior against Postgres so production matches the in-memory tests.

> No unit test (the suite runs in-memory by design — Postgres stores are unverified by tests in this repo). Verification = `tsc --noEmit` green + `deploy/remote.sh build && up && smoke` on the dev server. State this explicitly in the task report.

- [ ] **Step 1: Inspect the existing Postgres session store + the sessions migration**

Read `apps/api/src/adapters/persistence/postgres-session-store.ts` and the migration that creates the `sessions` table (in `apps/api/migrations/`). Note the column-naming convention (snake_case) and how rows map to `AgentSession` (the `rowToSession` mapper).

- [ ] **Step 2: Write the migration**

Create `apps/api/migrations/<NNN>_session_state.sql` (idempotent — `migrate.ts` runs it on every start):

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS latest_answer text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS todos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
```

- [ ] **Step 3: Implement the Postgres session-store methods**

In `postgres-session-store.ts`: extend the row mapper to read the new columns (`latest_answer`, `summary`, `todos`, `pinned`, `snoozed_until`) into `latestAnswer/summary/todos/pinned/snoozedUntil`, default `todos` to `[]`, and ensure `upsert`'s INSERT/`SELECT` includes them but its `ON CONFLICT` **does not** overwrite the managed columns (mirror how `permission_mode` is preserved). Add:

```ts
async patchState(id, patch) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.latestAnswer !== undefined) { sets.push(`latest_answer = $${++i}`); vals.push(patch.latestAnswer); }
  if (patch.summary !== undefined) { sets.push(`summary = $${++i}`); vals.push(patch.summary); }
  if (patch.todos !== undefined) { sets.push(`todos = $${++i}::jsonb`); vals.push(JSON.stringify(patch.todos)); }
  if (sets.length === 0) return this.get(id);
  const res = await this.pool.query(`UPDATE sessions SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, [id, ...vals]);
  return res.rows[0] ? this.rowToSession(res.rows[0]) : null;
}
async setPinned(id, pinned) {
  await this.pool.query(`UPDATE sessions SET pinned = $2 WHERE id = $1`, [id, pinned]);
}
async setSnoozedUntil(id, until) {
  await this.pool.query(`UPDATE sessions SET snoozed_until = $2 WHERE id = $1`, [id, until]);
}
```

(Adjust `this.pool` / `this.rowToSession` to the file's actual field names.)

- [ ] **Step 4: Implement `oldestPendingAtBySession` in the Postgres decision store**

In `postgres-decision-store.ts`, add (mirroring `countPendingBySession`'s query style):

```ts
async oldestPendingAtBySession() {
  const res = await this.pool.query(
    `SELECT session_id, MIN(created_at) AS oldest FROM decisions WHERE status = 'pending' GROUP BY session_id`
  );
  const out: Record<string, Date> = {};
  for (const row of res.rows) out[row.session_id] = new Date(row.oldest);
  return out;
}
```

(Use the file's actual column names for session id / created_at / status.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @rcw/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations apps/api/src/adapters/persistence/postgres-session-store.ts apps/api/src/adapters/persistence/postgres-decision-store.ts
git commit -m "feat(api): Postgres parity for session state + waitingSince (migration)

Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R"
```

---

## After all tasks

- [ ] Run the full suite once more: `pnpm --filter @rcw/shared build && pnpm --filter @rcw/api exec tsc --noEmit && pnpm --filter @rcw/api exec vitest run` — all green.
- [ ] Deploy to the dev server and smoke: `DEV_SERVER=youruser@your-server.example.com DEV_DIR=/home/youruser/redstone-cowork ./deploy/remote.sh up && ... smoke` — confirm migration applied and `/sessions/queue` responds.
- [ ] Report CP1 done to Jira (RCW) + Mattermost; push to GitHub.

## Spec coverage (self-review)

- Rich session state (latestAnswer/summary/todos) → Tasks 1, 3, 4 (+5 persisted). ✓
- Waiting queue, ordered longest-waiting-first, pinned first → Tasks 2, 3, 4. ✓
- Snooze/pin → Tasks 3, 4 (+5). ✓
- waitingSince for "waiting Nm" UI → Tasks 2, 3. ✓
- Auto-advance: server provides the ordered queue + existing `decision.resolved`/`session.updated` SSE; the *advance* itself is the desktop's job (CP2) and needs no extra server state. ✓ (by design — noted, not a gap)
- Real-time fan-out: reuses the existing `EventsBus`/SSE; every new mutation emits `session.updated`. ✓
- Out of scope for CP1 (later slices): file service, artifacts, port-forward, the redstone-agent MCP bridge + backlog half of the checklist, the desktop app itself (CP2).
