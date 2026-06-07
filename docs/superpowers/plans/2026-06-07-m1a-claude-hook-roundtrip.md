# M1a — Claude Code Hook Round-Trip (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISION 2026-06-07 (after Task 4, user decision):** blocking hooks are OUT — they hold the terminal hostage for local-first users. New mechanism: hooks are **notification-only** (never block, 10s timeout), and answers/commands are **delivered via tmux** into a Claude session started by our own `redstone-claude` wrapper. Tasks 1–5 unchanged; Tasks 5b–10 below in the **REVISED TASKS** section at the end of this file supersede the original Tasks 6–8 bodies (kept for history, marked SUPERSEDED).

**Goal:** Launch Claude via `redstone-claude` (tmux-owned session, args passed through); permission prompts and questions appear live in the Redstone web UI; answering there (or typing a brand-new command) is delivered into the session via `tmux send-keys`. The local terminal is NEVER blocked — local answering always works instantly, and locally-answered cards auto-resolve on the web.

**Architecture:** Stateless **blocking-hook gate** (per spike, `docs/research/2026-06-07-claude-code-hook-surface.md`): a `redstone` CLI installs inert hooks into `.claude/settings.local.json`; the handler no-ops for unattached sessions, attaches armed ones, POSTs events to the API, and for decision-bearing events long-polls `/decisions/:id/await` until the user resolves from the web — then emits the hook JSON answer. Server adds `sessions` + `decisions` modules (hexagonal, same port/adapter pattern as `EventStore`) and an SSE stream for live UI. Web adds cookie login (instance token, httpOnly) + proxy route handlers + a decisions/sessions UI.

**Tech Stack:** existing M0 stack + rxjs Subject for the in-process event bus, NestJS `@Sse`, EventSource on web. No new heavy deps; hook-cli is dependency-free Node 22 (global `fetch`).

**Out of scope (M1b/M2):** native mobile app + push (M1b), Stop-hook blocking "next instruction" continuation, LLM-generated decision summaries, headless/SDK sessions.

**Conventions locked here:**
- The hook handler must NEVER break a session: every path wrapped so unexpected errors → exit 0, no output, ≤2s API timeouts on non-blocking paths.
- Timeout fallback: no resolution within budget (`RCW_HOOK_WAIT_BUDGET_MS`, default 570 000ms; settings hook timeout 590s) → exit 0 with no output → prompt falls back to local terminal.
- Exactly-once resolution: atomic `UPDATE … WHERE status='pending' RETURNING`; losers get 409.
- Session status: `waiting` if pending decisions > 0, else by `last_seen_at`: <90s `active`, <300s `stale`, else `lost`.
- Hooks installed (interactive target): `SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`, `PermissionRequest`, `SessionEnd`. No `PreToolUse` in M1a.
- Hook output JSON shapes live ONLY in `apps/hook-cli/src/hook-output.ts` — they get verified against a real Claude Code in Task 10 and may be adjusted there (expected deviation point).

---

### Task 1: Shared schemas — AgentSession + Decision

**Files:**
- Create: `packages/shared/src/sessions/agent-session.ts`, `packages/shared/src/decisions/decision.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/decision.test.ts`

- [ ] **Step 1: Failing test** — `packages/shared/test/decision.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DecisionSchema, NewDecisionSchema, ResolutionSchema } from "../src/decisions/decision";
import { AgentSessionSchema } from "../src/sessions/agent-session";

describe("Decision schemas", () => {
  it("accepts a new permission decision", () => {
    const d = NewDecisionSchema.parse({
      sessionId: "s1", kind: "permission", title: "Bash: rm -rf build",
      body: { tool_name: "Bash" }, options: [{ label: "Allow" }, { label: "Deny" }],
    });
    expect(d.options).toHaveLength(2);
  });
  it("rejects unknown kind", () => {
    expect(() => NewDecisionSchema.parse({ sessionId: "s", kind: "nope", title: "t" })).toThrow();
  });
  it("parses a resolution with answers", () => {
    const r = ResolutionSchema.parse({ choice: "Allow", answers: { Q: "A" }, custom: null });
    expect(r.choice).toBe("Allow");
  });
  it("parses full decision with dates", () => {
    const d = DecisionSchema.parse({
      id: "9f3b8c1e-2a4d-4f6a-9c0d-1e2f3a4b5c6d", sessionId: "s1", kind: "question",
      title: "t", body: {}, options: [], status: "pending",
      createdAt: "2026-06-07T10:00:00Z", resolvedAt: null, resolution: null,
    });
    expect(d.createdAt).toBeInstanceOf(Date);
  });
  it("parses agent session", () => {
    const s = AgentSessionSchema.parse({
      id: "abc", machine: "devbox", cwd: "/home/u/p", gitBranch: null,
      attachedAt: "2026-06-07T10:00:00Z", lastSeenAt: "2026-06-07T10:01:00Z",
    });
    expect(s.lastSeenAt.getTime()).toBeGreaterThan(s.attachedAt.getTime());
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @rcw/shared test` — FAIL (modules missing).

- [ ] **Step 3: Implement**

`packages/shared/src/sessions/agent-session.ts`:
```ts
import { z } from "zod";

export const AgentSessionSchema = z.object({
  id: z.string().min(1),               // Claude Code session_id
  machine: z.string().min(1),
  cwd: z.string().min(1),
  gitBranch: z.string().nullable().default(null),
  attachedAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const SessionStatusSchema = z.enum(["active", "waiting", "stale", "lost"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const NewAgentSessionSchema = AgentSessionSchema.pick({ id: true, machine: true, cwd: true, gitBranch: true });
export type NewAgentSession = z.infer<typeof NewAgentSessionSchema>;
```

`packages/shared/src/decisions/decision.ts`:
```ts
import { z } from "zod";

export const DecisionKindSchema = z.enum(["permission", "question", "completion", "notification"]);
export const DecisionOptionSchema = z.object({ label: z.string().min(1), description: z.string().optional() });

export const ResolutionSchema = z.object({
  choice: z.string().nullable().default(null),                       // picked option label
  answers: z.record(z.string()).nullable().default(null),            // AskUserQuestion: question -> answer
  custom: z.string().nullable().default(null),                       // free-text reply
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export const NewDecisionSchema = z.object({
  sessionId: z.string().min(1),
  kind: DecisionKindSchema,
  title: z.string().min(1),
  body: z.record(z.unknown()).default({}),                           // raw hook payload subset
  options: z.array(DecisionOptionSchema).default([]),
});
export type NewDecision = z.infer<typeof NewDecisionSchema>;

export const DecisionSchema = NewDecisionSchema.extend({
  id: z.string().uuid(),
  status: z.enum(["pending", "resolved"]),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable().default(null),
  resolution: ResolutionSchema.nullable().default(null),
});
export type Decision = z.infer<typeof DecisionSchema>;
```

`packages/shared/src/index.ts` — add:
```ts
export * from "./sessions/agent-session.js";
export * from "./decisions/decision.js";
```

- [ ] **Step 4:** `pnpm --filter @rcw/shared test` PASS (8 total), `pnpm --filter @rcw/shared build` clean.
- [ ] **Step 5: Commit** `feat(shared): AgentSession + Decision schemas`

---

### Task 2: API — sessions module (attach, heartbeat, list with status)

**Files:**
- Create: `apps/api/migrations/002_sessions_decisions.sql`
- Create: `apps/api/src/domain/sessions/session-store.port.ts`
- Create: `apps/api/src/adapters/persistence/in-memory-session-store.ts`, `apps/api/src/adapters/persistence/postgres-session-store.ts`
- Create: `apps/api/src/application/sessions.service.ts`
- Create: `apps/api/src/adapters/http/sessions.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/sessions.e2e.test.ts`

- [ ] **Step 1: Migration** — `apps/api/migrations/002_sessions_decisions.sql`

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  machine TEXT NOT NULL,
  cwd TEXT NOT NULL,
  git_branch TEXT,
  attached_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body JSONB NOT NULL DEFAULT '{}'::jsonb,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions (status);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions (session_id);
```

- [ ] **Step 2: Failing test** — `apps/api/test/sessions.e2e.test.ts`

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("/sessions", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("401s without token", async () => {
    await request(app.getHttpServer()).get("/sessions").expect(401);
  });

  it("attaches, heartbeats, lists with status", async () => {
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-1", machine: "devbox", cwd: "/p", gitBranch: "main" }).expect(201);
    await request(app.getHttpServer()).post("/sessions/sess-1/heartbeat").set(auth).expect(200);
    const res = await request(app.getHttpServer()).get("/sessions").set(auth).expect(200);
    const s = res.body.find((x: { id: string }) => x.id === "sess-1");
    expect(s.status).toBe("active");
    expect(s.pendingDecisions).toBe(0);
  });

  it("404s heartbeat for unknown session", async () => {
    await request(app.getHttpServer()).post("/sessions/nope/heartbeat").set(auth).expect(404);
  });

  it("attach is idempotent (re-attach updates lastSeen)", async () => {
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-1", machine: "devbox", cwd: "/p" }).expect(201);
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter @rcw/api test sessions` — FAIL (404s).

- [ ] **Step 4: Implement**

`apps/api/src/domain/sessions/session-store.port.ts`:
```ts
import type { AgentSession } from "@rcw/shared";

export interface SessionStore {
  upsert(session: AgentSession): Promise<AgentSession>;
  touch(id: string, at: Date): Promise<boolean>;      // false = unknown id
  get(id: string): Promise<AgentSession | null>;
  list(): Promise<AgentSession[]>;
}
export const SESSION_STORE = Symbol("SessionStore");
```

`apps/api/src/adapters/persistence/in-memory-session-store.ts`:
```ts
import type { AgentSession } from "@rcw/shared";
import type { SessionStore } from "../../domain/sessions/session-store.port";

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, AgentSession>();
  async upsert(s: AgentSession) {
    const existing = this.sessions.get(s.id);
    const merged = existing ? { ...existing, ...s, attachedAt: existing.attachedAt } : s;
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
}
```

`apps/api/src/adapters/persistence/postgres-session-store.ts`:
```ts
import type { Pool } from "pg";
import { AgentSessionSchema, type AgentSession } from "@rcw/shared";
import type { SessionStore } from "../../domain/sessions/session-store.port";

const ROW = `id, machine, cwd, git_branch AS "gitBranch", attached_at AS "attachedAt", last_seen_at AS "lastSeenAt"`;

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async upsert(s: AgentSession): Promise<AgentSession> {
    const { rows } = await this.pool.query(
      `INSERT INTO sessions (id, machine, cwd, git_branch, attached_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET machine=$2, cwd=$3, git_branch=$4, last_seen_at=$6
       RETURNING ${ROW}`,
      [s.id, s.machine, s.cwd, s.gitBranch, s.attachedAt, s.lastSeenAt]
    );
    return AgentSessionSchema.parse(rows[0]);
  }
  async touch(id: string, at: Date): Promise<boolean> {
    const r = await this.pool.query("UPDATE sessions SET last_seen_at=$2 WHERE id=$1", [id, at]);
    return (r.rowCount ?? 0) > 0;
  }
  async get(id: string): Promise<AgentSession | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM sessions WHERE id=$1`, [id]);
    return rows[0] ? AgentSessionSchema.parse(rows[0]) : null;
  }
  async list(): Promise<AgentSession[]> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM sessions ORDER BY last_seen_at DESC`);
    return rows.map((r) => AgentSessionSchema.parse(r));
  }
}
```

`apps/api/src/application/sessions.service.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common";
import { NewAgentSessionSchema, type AgentSession, type SessionStatus } from "@rcw/shared";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";

export type SessionView = AgentSession & { status: SessionStatus; pendingDecisions: number };

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
  constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

  async attach(input: unknown): Promise<AgentSession> {
    const parsed = NewAgentSessionSchema.parse(input);
    const now = new Date();
    return this.store.upsert({ ...parsed, attachedAt: now, lastSeenAt: now });
  }
  async heartbeat(id: string): Promise<boolean> {
    return this.store.touch(id, new Date());
  }
  async listViews(pendingBySession: Record<string, number>): Promise<SessionView[]> {
    const now = new Date();
    return (await this.store.list()).map((s) => ({
      ...s,
      pendingDecisions: pendingBySession[s.id] ?? 0,
      status: sessionStatus(s, pendingBySession[s.id] ?? 0, now),
    }));
  }
  get(id: string) { return this.store.get(id); }
}
```

`apps/api/src/adapters/http/sessions.controller.ts` (DecisionsService arrives Task 3 — for THIS task pass pending counts as `{}`; controller below is final form, so create a minimal `DecisionsService` stub ONLY if needed — better: inject nothing yet and use `{}` inline, then Task 3 swaps it):
```ts
import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { ZodError } from "zod";
import { SessionsService } from "../../application/sessions.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("sessions")
@UseGuards(InstanceTokenGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  async attach(@Body() body: unknown) {
    try {
      return await this.sessions.attach(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/heartbeat")
  async heartbeat(@Param("id") id: string) {
    if (!(await this.sessions.heartbeat(id))) throw new NotFoundException();
    return { ok: true };
  }

  @Get()
  list() {
    return this.sessions.listViews({});
  }
}
```

`apps/api/src/app.module.ts` — add to the existing module: `SessionsController` to controllers; providers `SessionsService` and
```ts
{
  provide: SESSION_STORE,
  useFactory: () => {
    const { DATABASE_URL } = loadConfig();
    return DATABASE_URL ? new PostgresSessionStore(createPool(DATABASE_URL)) : new InMemorySessionStore();
  },
},
```
**Refactor while here (single pool):** extract one `PG_POOL` provider (`useFactory` → `DATABASE_URL ? createPool(DATABASE_URL) : null`) and have both `EVENT_STORE` and `SESSION_STORE` factories inject it, so the app shares one pool. Also add `OnModuleDestroy` in a tiny `PoolHolder` class provider that calls `pool.end()` (clears P1 tech-debt item).

- [ ] **Step 5:** `pnpm --filter @rcw/api test` PASS, build clean.
- [ ] **Step 6: Commit** `feat(api): sessions module (attach/heartbeat/list) + shared pg pool with graceful shutdown`

---

### Task 3: API — decisions module (create, list, pending counts)

**Files:**
- Create: `apps/api/src/domain/decisions/decision-store.port.ts`
- Create: `apps/api/src/adapters/persistence/in-memory-decision-store.ts`, `apps/api/src/adapters/persistence/postgres-decision-store.ts`
- Create: `apps/api/src/application/decisions.service.ts`
- Create: `apps/api/src/adapters/http/decisions.controller.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/adapters/http/sessions.controller.ts`
- Test: `apps/api/test/decisions.e2e.test.ts`

- [ ] **Step 1: Failing test** — `apps/api/test/decisions.e2e.test.ts`

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("/decisions", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-d", machine: "m", cwd: "/p" });
  });
  afterAll(() => app.close());

  it("creates and lists a pending decision; session shows waiting", async () => {
    const created = await request(app.getHttpServer()).post("/decisions").set(auth).send({
      sessionId: "sess-d", kind: "permission", title: "Bash: npm install",
      body: { tool_name: "Bash" }, options: [{ label: "Allow" }, { label: "Deny" }],
    }).expect(201);
    expect(created.body.status).toBe("pending");

    const list = await request(app.getHttpServer()).get("/decisions?status=pending").set(auth).expect(200);
    expect(list.body.some((d: { id: string }) => d.id === created.body.id)).toBe(true);

    const sessions = await request(app.getHttpServer()).get("/sessions").set(auth).expect(200);
    const s = sessions.body.find((x: { id: string }) => x.id === "sess-d");
    expect(s.status).toBe("waiting");
    expect(s.pendingDecisions).toBeGreaterThan(0);
  });

  it("400s invalid kind", async () => {
    await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-d", kind: "bogus", title: "x" }).expect(400);
  });

  it("404s decision for unknown session", async () => {
    await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "ghost", kind: "permission", title: "x" }).expect(404);
  });
});
```

- [ ] **Step 2: Run** — FAIL (404).

- [ ] **Step 3: Implement**

`apps/api/src/domain/decisions/decision-store.port.ts`:
```ts
import type { Decision, Resolution } from "@rcw/shared";

export interface DecisionStore {
  create(d: Decision): Promise<Decision>;
  get(id: string): Promise<Decision | null>;
  listPending(): Promise<Decision[]>;
  /** Atomic: only succeeds if still pending. Returns null when already resolved/unknown. */
  resolve(id: string, resolution: Resolution, at: Date): Promise<Decision | null>;
  countPendingBySession(): Promise<Record<string, number>>;
}
export const DECISION_STORE = Symbol("DecisionStore");
```

`apps/api/src/adapters/persistence/in-memory-decision-store.ts`:
```ts
import type { Decision, Resolution } from "@rcw/shared";
import type { DecisionStore } from "../../domain/decisions/decision-store.port";

export class InMemoryDecisionStore implements DecisionStore {
  private decisions = new Map<string, Decision>();
  async create(d: Decision) { this.decisions.set(d.id, d); return d; }
  async get(id: string) { return this.decisions.get(id) ?? null; }
  async listPending() {
    return [...this.decisions.values()].filter((d) => d.status === "pending")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async resolve(id: string, resolution: Resolution, at: Date) {
    const d = this.decisions.get(id);
    if (!d || d.status !== "pending") return null;
    const resolved: Decision = { ...d, status: "resolved", resolution, resolvedAt: at };
    this.decisions.set(id, resolved);
    return resolved;
  }
  async countPendingBySession() {
    const counts: Record<string, number> = {};
    for (const d of this.decisions.values())
      if (d.status === "pending") counts[d.sessionId] = (counts[d.sessionId] ?? 0) + 1;
    return counts;
  }
}
```

`apps/api/src/adapters/persistence/postgres-decision-store.ts`:
```ts
import type { Pool } from "pg";
import { DecisionSchema, type Decision, type Resolution } from "@rcw/shared";
import type { DecisionStore } from "../../domain/decisions/decision-store.port";

const ROW = `id, session_id AS "sessionId", kind, title, body, options, status, resolution,
             created_at AS "createdAt", resolved_at AS "resolvedAt"`;

export class PostgresDecisionStore implements DecisionStore {
  constructor(private readonly pool: Pool) {}

  async create(d: Decision): Promise<Decision> {
    await this.pool.query(
      `INSERT INTO decisions (id, session_id, kind, title, body, options, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [d.id, d.sessionId, d.kind, d.title, JSON.stringify(d.body), JSON.stringify(d.options), d.status, d.createdAt]
    );
    return d;
  }
  async get(id: string): Promise<Decision | null> {
    const { rows } = await this.pool.query(`SELECT ${ROW} FROM decisions WHERE id=$1`, [id]);
    return rows[0] ? DecisionSchema.parse(rows[0]) : null;
  }
  async listPending(): Promise<Decision[]> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW} FROM decisions WHERE status='pending' ORDER BY created_at DESC`);
    return rows.map((r) => DecisionSchema.parse(r));
  }
  async resolve(id: string, resolution: Resolution, at: Date): Promise<Decision | null> {
    const { rows } = await this.pool.query(
      `UPDATE decisions SET status='resolved', resolution=$2, resolved_at=$3
       WHERE id=$1 AND status='pending' RETURNING ${ROW}`,
      [id, JSON.stringify(resolution), at]
    );
    return rows[0] ? DecisionSchema.parse(rows[0]) : null;
  }
  async countPendingBySession(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT session_id, COUNT(*)::int AS n FROM decisions WHERE status='pending' GROUP BY session_id`);
    return Object.fromEntries(rows.map((r) => [r.session_id, r.n]));
  }
}
```

`apps/api/src/application/decisions.service.ts`:
```ts
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { NewDecisionSchema, type Decision } from "@rcw/shared";
import { randomUUID } from "node:crypto";
import { DECISION_STORE, type DecisionStore } from "../domain/decisions/decision-store.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";

@Injectable()
export class DecisionsService {
  constructor(
    @Inject(DECISION_STORE) private readonly store: DecisionStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore
  ) {}

  async create(input: unknown): Promise<Decision> {
    const parsed = NewDecisionSchema.parse(input);
    if (!(await this.sessions.get(parsed.sessionId))) throw new NotFoundException("unknown session");
    const decision: Decision = {
      ...parsed, id: randomUUID(), status: "pending",
      createdAt: new Date(), resolvedAt: null, resolution: null,
    };
    return this.store.create(decision);
  }
  listPending() { return this.store.listPending(); }
  get(id: string) { return this.store.get(id); }
  countPendingBySession() { return this.store.countPendingBySession(); }
}
```

`apps/api/src/adapters/http/decisions.controller.ts`:
```ts
import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { DecisionsService } from "../../application/decisions.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("decisions")
@UseGuards(InstanceTokenGuard)
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.decisions.create(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get()
  list(@Query("status") _status?: string) {
    return this.decisions.listPending(); // only pending exposed in M1a
  }
}
```

Wire in `app.module.ts` (DECISION_STORE factory mirrors SESSION_STORE using the shared pool). Update `SessionsController.list()`:
```ts
@Get()
async list() {
  return this.sessions.listViews(await this.decisions.countPendingBySession());
}
```
(inject `DecisionsService` into `SessionsController`).

- [ ] **Step 4:** all api tests PASS, build clean.
- [ ] **Step 5: Commit** `feat(api): decisions module (create/list, pending counts into session views)`

---

### Task 4: API — exactly-once resolve + long-poll await

**Files:**
- Create: `apps/api/src/application/decision-waiters.ts`
- Modify: `apps/api/src/application/decisions.service.ts`, `apps/api/src/adapters/http/decisions.controller.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/test/decision-resolve.e2e.test.ts`

- [ ] **Step 1: Failing test** — `apps/api/test/decision-resolve.e2e.test.ts`

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("decision resolve + await", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post("/sessions").set(auth).send({ id: "sess-r", machine: "m", cwd: "/p" });
  });
  afterAll(() => app.close());

  const createDecision = async () => {
    const r = await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-r", kind: "permission", title: "t", options: [{ label: "Allow" }] });
    return r.body.id as string;
  };

  it("resolves exactly once — second resolver gets 409", async () => {
    const id = await createDecision();
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth)
      .send({ choice: "Allow" }).expect(200);
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth)
      .send({ choice: "Deny" }).expect(409);
  });

  it("await returns resolution when resolved mid-poll", async () => {
    const id = await createDecision();
    const awaitP = request(app.getHttpServer())
      .get(`/decisions/${id}/await?timeoutMs=5000`).set(auth);
    await new Promise((r) => setTimeout(r, 150));
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth).send({ choice: "Allow" });
    const res = await awaitP;
    expect(res.status).toBe(200);
    expect(res.body.resolution.choice).toBe("Allow");
  });

  it("await times out with 204 when unresolved", async () => {
    const id = await createDecision();
    await request(app.getHttpServer())
      .get(`/decisions/${id}/await?timeoutMs=300`).set(auth).expect(204);
  });

  it("await returns immediately for already-resolved decision", async () => {
    const id = await createDecision();
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth).send({ choice: "Allow" });
    const res = await request(app.getHttpServer())
      .get(`/decisions/${id}/await?timeoutMs=5000`).set(auth).expect(200);
    expect(res.body.status).toBe("resolved");
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/application/decision-waiters.ts`:
```ts
import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { Decision } from "@rcw/shared";

/** In-process wakeup channel for long-polling /decisions/:id/await (single API instance by design). */
@Injectable()
export class DecisionWaiters {
  private readonly emitter = new EventEmitter().setMaxListeners(1000);

  notify(decision: Decision) { this.emitter.emit(decision.id, decision); }

  wait(id: string, ms: number): Promise<Decision | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.emitter.off(id, onResolved); resolve(null); }, ms);
      const onResolved = (d: Decision) => { clearTimeout(timer); resolve(d); };
      this.emitter.once(id, onResolved);
    });
  }
}
```

`decisions.service.ts` — add (inject `DecisionWaiters`):
```ts
async resolve(id: string, input: unknown): Promise<Decision> {
  const resolution = ResolutionSchema.parse(input);
  const resolved = await this.store.resolve(id, resolution, new Date());
  if (!resolved) {
    const existing = await this.store.get(id);
    if (!existing) throw new NotFoundException();
    throw new ConflictException("already resolved");
  }
  this.waiters.notify(resolved);
  return resolved;
}

async await(id: string, timeoutMs: number): Promise<Decision | null> {
  const existing = await this.store.get(id);
  if (!existing) throw new NotFoundException();
  if (existing.status === "resolved") return existing;
  return this.waiters.wait(id, Math.min(timeoutMs, 30_000));
}
```

`decisions.controller.ts` — add:
```ts
@Post(":id/resolve")
async resolve(@Param("id") id: string, @Body() body: unknown) {
  try {
    return await this.decisions.resolve(id, body);
  } catch (e) {
    if (e instanceof ZodError) throw new BadRequestException(e.issues);
    throw e;
  }
}

@Get(":id/await")
async awaitResolution(@Param("id") id: string, @Query("timeoutMs") timeoutMs = "25000", @Res() res: Response) {
  const d = await this.decisions.await(id, Number(timeoutMs) || 25_000);
  if (!d) return res.status(204).send();
  return res.status(200).json(d);
}
```
(`import type { Response } from "express"`; register `DecisionWaiters` as provider.)

- [ ] **Step 4:** all api tests PASS, build clean.
- [ ] **Step 5: Commit** `feat(api): exactly-once decision resolve + long-poll await`

---

### Task 5: API — SSE stream for live UI

**Files:**
- Create: `apps/api/src/application/events-bus.ts`, `apps/api/src/adapters/http/stream.controller.ts`
- Modify: `apps/api/src/application/decisions.service.ts`, `apps/api/src/application/sessions.service.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/test/stream.e2e.test.ts`

- [ ] **Step 1: Failing test** — `apps/api/test/stream.e2e.test.ts`

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { EventsBus } from "../src/application/events-bus";

const auth = { Authorization: "Bearer test-token" };

describe("GET /stream (SSE)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await app.listen(0);
  });
  afterAll(() => app.close());

  it("401s without token", async () => {
    await request(app.getHttpServer()).get("/stream").expect(401);
  });

  it("streams decision.created events", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/stream`, { headers: { Authorization: "Bearer test-token" } });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    app.get(EventsBus).emit({ type: "decision.created", payload: { id: "x" } });
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("decision.created");
    await reader.cancel();
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/application/events-bus.ts`:
```ts
import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export type ServerEvent = { type: "decision.created" | "decision.resolved" | "session.updated"; payload: unknown };

@Injectable()
export class EventsBus {
  readonly stream$ = new Subject<ServerEvent>();
  emit(e: ServerEvent) { this.stream$.next(e); }
}
```

`apps/api/src/adapters/http/stream.controller.ts`:
```ts
import { Controller, Sse, UseGuards } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { EventsBus } from "../../application/events-bus";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller()
export class StreamController {
  constructor(private readonly bus: EventsBus) {}

  @UseGuards(InstanceTokenGuard)
  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return this.bus.stream$.pipe(map((e) => ({ data: e }) as MessageEvent));
  }
}
```

Emit from services: `DecisionsService.create` → `bus.emit({type:"decision.created", payload: decision})`; `resolve` → `decision.resolved`; `SessionsService.attach`/`heartbeat` → `session.updated` with `{id}`. Register `EventsBus`, `StreamController`.

- [ ] **Step 4:** all tests PASS, build clean. **Step 5: Commit** `feat(api): SSE stream of decision/session events`

---

### [SUPERSEDED by REVISED TASKS section] Task 6: hook-cli — scaffold, config, installer, arming

**Files:**
- Create: `apps/hook-cli/package.json`, `apps/hook-cli/tsconfig.json`, `apps/hook-cli/vitest.config.ts`
- Create: `apps/hook-cli/src/main.ts`, `src/config.ts`, `src/state.ts`, `src/installer.ts`
- Test: `apps/hook-cli/test/installer.test.ts`

- [ ] **Step 1: Package files**

`apps/hook-cli/package.json`:
```json
{
  "name": "@rcw/hook-cli",
  "version": "0.0.1",
  "bin": { "redstone": "./dist/main.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "devDependencies": { "@types/node": "^22.0.0", "vitest": "^3.1.0" }
}
```
`tsconfig.json` mirrors worker (CommonJS, outDir dist, rootDir src). `vitest.config.ts` mirrors shared.

- [ ] **Step 2: Failing test** — `apps/hook-cli/test/installer.test.ts`

```ts
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHooks, HOOK_EVENTS } from "../src/installer";
import { armAttach, isArmed, disarm } from "../src/state";

describe("installer", () => {
  it("writes hooks for all events into empty settings.local.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    installHooks(dir, "/usr/local/bin/redstone");
    const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    for (const ev of HOOK_EVENTS) expect(settings.hooks[ev]).toBeDefined();
    expect(JSON.stringify(settings)).toContain("/usr/local/bin/redstone handle");
  });

  it("merges without clobbering existing settings/hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude/settings.local.json"), JSON.stringify({
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool" }] }] },
    }));
    installHooks(dir, "/bin/redstone");
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    expect(s.permissions.allow).toContain("Bash(ls:*)");
    expect(JSON.stringify(s.hooks.Stop)).toContain("other-tool");
    expect(JSON.stringify(s.hooks.Stop)).toContain("/bin/redstone handle");
  });

  it("is idempotent (no duplicate hook entries)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-"));
    installHooks(dir, "/bin/redstone");
    installHooks(dir, "/bin/redstone");
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
    expect(s.hooks.Stop.flatMap((m: { hooks: unknown[] }) => m.hooks)).toHaveLength(1);
  });
});

describe("arming", () => {
  it("arm/disarm round-trip with TTL", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rcw-state-"));
    armAttach("/some/project", stateDir);
    expect(isArmed("/some/project", stateDir)).toBe(true);
    disarm("/some/project", stateDir);
    expect(isArmed("/some/project", stateDir)).toBe(false);
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter @rcw/hook-cli test` — FAIL.

- [ ] **Step 4: Implement**

`apps/hook-cli/src/config.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Config = { serverUrl: string; token: string };
export const configDir = () => process.env.RCW_CONFIG_DIR ?? join(homedir(), ".redstone");
const configPath = () => join(configDir(), "config.json");

export const loadCliConfig = (): Config | null => {
  try { return JSON.parse(readFileSync(configPath(), "utf8")); } catch { return null; }
};
export const saveCliConfig = (c: Config) => {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
};
```

`apps/hook-cli/src/state.ts` (armed-attach markers, 15-min TTL):
```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { configDir } from "./config";

const TTL_MS = 15 * 60_000;
const markerPath = (cwd: string, stateDir: string) =>
  join(stateDir, `armed-${createHash("sha256").update(cwd).digest("hex").slice(0, 16)}.json`);

export const armAttach = (cwd: string, stateDir = join(configDir(), "state")) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(markerPath(cwd, stateDir), JSON.stringify({ cwd, armedAt: Date.now() }));
};
export const isArmed = (cwd: string, stateDir = join(configDir(), "state")): boolean => {
  const p = markerPath(cwd, stateDir);
  if (!existsSync(p)) return false;
  try {
    const { armedAt } = JSON.parse(readFileSync(p, "utf8"));
    if (Date.now() - armedAt > TTL_MS) { rmSync(p, { force: true }); return false; }
    return true;
  } catch { return false; }
};
export const disarm = (cwd: string, stateDir = join(configDir(), "state")) =>
  rmSync(markerPath(cwd, stateDir), { force: true });
```

`apps/hook-cli/src/installer.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "Notification", "PermissionRequest", "SessionEnd"] as const;
const HOOK_TIMEOUT_S = 590; // < Claude's 600s ceiling; handler budget is RCW_HOOK_WAIT_BUDGET_MS (570s)

type HookEntry = { type: "command"; command: string; timeout?: number };
type Matcher = { matcher?: string; hooks: HookEntry[] };

export function installHooks(projectDir: string, binPath: string) {
  const settingsPath = join(projectDir, ".claude", "settings.local.json");
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  settings.hooks = settings.hooks ?? {};
  const command = `${binPath} handle`;
  for (const event of HOOK_EVENTS) {
    const matchers: Matcher[] = settings.hooks[event] ?? [];
    const already = matchers.some((m) => m.hooks?.some((h) => h.command === command));
    if (!already) {
      matchers.push({ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] });
      settings.hooks[event] = matchers;
    }
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return settingsPath;
}
```

`apps/hook-cli/src/main.ts` (router; `handle` lands Task 7):
```ts
#!/usr/bin/env node
import { argv, exit } from "node:process";
import { realpathSync } from "node:fs";
import { armAttach } from "./state";
import { installHooks } from "./installer";
import { loadCliConfig, saveCliConfig } from "./config";

const usage = `redstone <command>
  init --server <url> --token <token>   configure once
  hook                                  install hooks here + arm attach for the next session event
  handle                                (internal) Claude Code hook entrypoint
  status                                show config + attach state`;

async function main() {
  const cmd = argv[2];
  if (cmd === "init") {
    const server = argv[argv.indexOf("--server") + 1];
    const token = argv[argv.indexOf("--token") + 1];
    if (!server || !token) { console.error(usage); exit(1); }
    saveCliConfig({ serverUrl: server.replace(/\/$/, ""), token });
    console.log("redstone configured");
  } else if (cmd === "hook") {
    if (!loadCliConfig()) { console.error("run `redstone init` first"); exit(1); }
    const bin = realpathSync(argv[1]);
    const settingsPath = installHooks(process.cwd(), `node ${bin}`);
    armAttach(process.cwd());
    console.log(`hooks installed -> ${settingsPath}`);
    console.log("attach armed: the next Claude Code activity in this directory will connect this session.");
  } else if (cmd === "handle") {
    const { handle } = await import("./handler");
    await handle();
  } else if (cmd === "status") {
    console.log(JSON.stringify({ config: loadCliConfig() }, null, 2));
  } else {
    console.error(usage); exit(1);
  }
}
main().catch(() => exit(0)); // never propagate failures into a Claude session
```

- [ ] **Step 5:** tests PASS, build clean. **Step 6: Commit** `feat(hook-cli): scaffold, installer, attach arming`

---

### [SUPERSEDED by REVISED TASKS section] Task 7: hook-cli — handler: attach/heartbeat + non-blocking events

**Files:**
- Create: `apps/hook-cli/src/api-client.ts`, `apps/hook-cli/src/handler.ts`
- Test: `apps/hook-cli/test/handler.test.ts`

Design: `handle()` reads stdin JSON and delegates to exported `processEvent(event, deps)` for testability; `deps` = `{ api, isArmed, disarm, machine }`. Non-blocking API calls use 2s timeout. ANY error → return `null` (no output, exit 0).

- [ ] **Step 1: Failing test** — `apps/hook-cli/test/handler.test.ts`

```ts
import { processEvent, type Deps } from "../src/handler";

const baseDeps = (overrides: Partial<Deps> = {}): Deps => ({
  api: {
    heartbeat: vi.fn().mockResolvedValue(true),
    attach: vi.fn().mockResolvedValue(undefined),
    createDecision: vi.fn().mockResolvedValue({ id: "d1" }),
    awaitResolution: vi.fn().mockResolvedValue(null),
  },
  isArmed: vi.fn().mockReturnValue(false),
  disarm: vi.fn(),
  machine: "testbox",
  waitBudgetMs: 1000,
  ...overrides,
});

const ev = (name: string, extra: object = {}) =>
  ({ hook_event_name: name, session_id: "s1", cwd: "/p", ...extra });

describe("processEvent", () => {
  it("unattached + unarmed -> no-op, no attach", async () => {
    const deps = baseDeps({ api: { ...baseDeps().api, heartbeat: vi.fn().mockResolvedValue(false) } });
    const out = await processEvent(ev("UserPromptSubmit"), deps);
    expect(out).toBeNull();
    expect(deps.api.attach).not.toHaveBeenCalled();
  });

  it("unattached + armed -> attaches and disarms", async () => {
    const deps = baseDeps({
      api: { ...baseDeps().api, heartbeat: vi.fn().mockResolvedValue(false) },
      isArmed: vi.fn().mockReturnValue(true),
    });
    await processEvent(ev("UserPromptSubmit"), deps);
    expect(deps.api.attach).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", cwd: "/p" }));
    expect(deps.disarm).toHaveBeenCalled();
  });

  it("attached Stop -> creates completion notification, no blocking", async () => {
    const deps = baseDeps();
    const out = await processEvent(ev("Stop"), deps);
    expect(deps.api.createDecision).toHaveBeenCalledWith(expect.objectContaining({ kind: "completion" }));
    expect(out).toBeNull();
  });

  it("api down -> silent null, never throws", async () => {
    const deps = baseDeps({ api: { ...baseDeps().api, heartbeat: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) } });
    await expect(processEvent(ev("Stop"), deps)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`apps/hook-cli/src/api-client.ts`:
```ts
import type { Config } from "./config";

const json = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

export class ApiClient {
  constructor(private readonly cfg: Config) {}

  private async req(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    return fetch(`${this.cfg.serverUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }
  /** true = known session (touched), false = unknown */
  async heartbeat(id: string): Promise<boolean> {
    const r = await this.req(`/sessions/${encodeURIComponent(id)}/heartbeat`, { method: "POST", headers: json(this.cfg.token) }, 2000);
    if (r.status === 404) return false;
    if (!r.ok) throw new Error(`heartbeat ${r.status}`);
    return true;
  }
  async attach(s: { id: string; machine: string; cwd: string; gitBranch: string | null }): Promise<void> {
    const r = await this.req("/sessions", { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(s) }, 3000);
    if (!r.ok) throw new Error(`attach ${r.status}`);
  }
  async createDecision(d: object): Promise<{ id: string }> {
    const r = await this.req("/decisions", { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(d) }, 3000);
    if (!r.ok) throw new Error(`createDecision ${r.status}`);
    return r.json();
  }
  /** Long-poll loop; resolves null on budget exhaustion. */
  async awaitResolution(id: string, budgetMs: number): Promise<{ resolution: unknown } | null> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const pollMs = Math.min(25_000, deadline - Date.now());
      try {
        const r = await this.req(`/decisions/${id}/await?timeoutMs=${pollMs}`,
          { headers: json(this.cfg.token) }, pollMs + 5000);
        if (r.status === 200) return r.json();
        if (r.status !== 204) return null; // 404/5xx: stop waiting, fall back to terminal
      } catch { /* transient network error: keep polling until deadline */ }
    }
    return null;
  }
}
```

`apps/hook-cli/src/handler.ts`:
```ts
import { hostname } from "node:os";
import { loadCliConfig } from "./config";
import { ApiClient } from "./api-client";
import { isArmed as isArmedFs, disarm as disarmFs } from "./state";
import { buildBlockingDecision, mapResolutionToHookOutput } from "./hook-output";

export type HookEvent = {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [k: string]: unknown;
};

export type Deps = {
  api: Pick<ApiClient, "heartbeat" | "attach" | "createDecision" | "awaitResolution">;
  isArmed: (cwd: string) => boolean;
  disarm: (cwd: string) => void;
  machine: string;
  waitBudgetMs: number;
};

const BLOCKING_EVENTS = new Set(["PermissionRequest"]);

export async function processEvent(event: HookEvent, deps: Deps): Promise<object | null> {
  try {
    const known = await deps.api.heartbeat(event.session_id);
    if (!known) {
      if (!deps.isArmed(event.cwd)) return null;          // not ours — stay silent
      await deps.api.attach({ id: event.session_id, machine: deps.machine, cwd: event.cwd, gitBranch: null });
      deps.disarm(event.cwd);
    }

    switch (event.hook_event_name) {
      case "Stop":
        await deps.api.createDecision({
          sessionId: event.session_id, kind: "completion",
          title: "Claude finished a task", body: {}, options: [],
        });
        return null;
      case "Notification": {
        const message = String(event.message ?? "");
        if (!message) return null;
        await deps.api.createDecision({
          sessionId: event.session_id, kind: "notification", title: message.slice(0, 200), body: { message }, options: [],
        });
        return null;
      }
      case "PermissionRequest": {
        const spec = buildBlockingDecision(event);
        if (!spec) return null;
        const { id } = await deps.api.createDecision({ sessionId: event.session_id, ...spec });
        const result = await deps.api.awaitResolution(id, deps.waitBudgetMs);
        if (!result) return null;                          // timeout -> local terminal fallback
        return mapResolutionToHookOutput(event, result.resolution);
      }
      default:
        return null;                                       // SessionStart/UserPromptSubmit/SessionEnd: heartbeat was enough
    }
  } catch {
    return null;                                           // NEVER break the session
  }
}

export async function handle(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  let event: HookEvent;
  try { event = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return; }
  const cfg = loadCliConfig();
  if (!cfg) return;
  const out = await processEvent(event, {
    api: new ApiClient(cfg),
    isArmed: isArmedFs,
    disarm: disarmFs,
    machine: hostname(),
    waitBudgetMs: Number(process.env.RCW_HOOK_WAIT_BUDGET_MS ?? 570_000),
  });
  if (out) process.stdout.write(JSON.stringify(out));
}
```
(`hook-output.ts` arrives in Task 8 — for THIS task create it with stub exports returning `null` so tests above pass; Task 8 fills it via TDD.)

- [ ] **Step 4:** tests PASS, build clean. **Step 5: Commit** `feat(hook-cli): handler attach/heartbeat + non-blocking event capture`

---

### [SUPERSEDED by REVISED TASKS section] Task 8: hook-cli — blocking decisions (permission + AskUserQuestion)

**Files:**
- Create (replace stub): `apps/hook-cli/src/hook-output.ts`
- Test: `apps/hook-cli/test/hook-output.test.ts`, extend `apps/hook-cli/test/handler.test.ts`

- [ ] **Step 1: Failing tests** — `apps/hook-cli/test/hook-output.test.ts`

```ts
import { buildBlockingDecision, mapResolutionToHookOutput } from "../src/hook-output";

const permissionEvent = {
  hook_event_name: "PermissionRequest", session_id: "s", cwd: "/p",
  tool_name: "Bash", tool_input: { command: "npm install" },
};
const questionEvent = {
  hook_event_name: "PermissionRequest", session_id: "s", cwd: "/p",
  tool_name: "AskUserQuestion",
  tool_input: { questions: [{ question: "Which approach?", header: "Approach",
    options: [{ label: "A", description: "fast" }, { label: "B", description: "safe" }], multiSelect: false }] },
};

describe("buildBlockingDecision", () => {
  it("maps a tool permission to a permission decision with Allow/Deny", () => {
    const d = buildBlockingDecision(permissionEvent)!;
    expect(d.kind).toBe("permission");
    expect(d.title).toContain("Bash");
    expect(d.options.map((o) => o.label)).toEqual(["Allow", "Deny"]);
    expect(d.body.tool_input).toEqual({ command: "npm install" });
  });
  it("maps AskUserQuestion to a question decision carrying the options", () => {
    const d = buildBlockingDecision(questionEvent)!;
    expect(d.kind).toBe("question");
    expect(d.title).toBe("Which approach?");
    expect(d.options).toEqual([{ label: "A", description: "fast" }, { label: "B", description: "safe" }]);
  });
});

describe("mapResolutionToHookOutput", () => {
  it("permission Allow -> behavior allow", () => {
    const out = mapResolutionToHookOutput(permissionEvent, { choice: "Allow", answers: null, custom: null }) as never;
    expect(JSON.stringify(out)).toContain("allow");
  });
  it("permission Deny with custom note -> behavior deny + message", () => {
    const out = JSON.stringify(mapResolutionToHookOutput(permissionEvent, { choice: "Deny", answers: null, custom: "use pnpm instead" }));
    expect(out).toContain("deny");
    expect(out).toContain("use pnpm instead");
  });
  it("question answer -> updatedInput with answers", () => {
    const out = JSON.stringify(mapResolutionToHookOutput(questionEvent, { choice: "A", answers: { "Which approach?": "A" }, custom: null }));
    expect(out).toContain("updatedInput");
    expect(out).toContain('"A"');
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`apps/hook-cli/src/hook-output.ts`:
```ts
// ⚠️ The ONLY module that knows Claude Code's hook payload/response shapes.
// Verified against a live Claude Code in the M1a final task — adjust HERE if the real schema differs.
import type { HookEvent } from "./handler";

type Option = { label: string; description?: string };
export type DecisionSpec = { kind: "permission" | "question"; title: string; body: Record<string, unknown>; options: Option[] };

export function buildBlockingDecision(event: HookEvent): DecisionSpec | null {
  if (event.tool_name === "AskUserQuestion") {
    const questions = (event.tool_input?.questions ?? []) as Array<{ question: string; options?: Option[] }>;
    const q = questions[0];
    if (!q) return null;
    return { kind: "question", title: q.question, body: { tool_input: event.tool_input }, options: q.options ?? [] };
  }
  const summary = JSON.stringify(event.tool_input ?? {}).slice(0, 160);
  return {
    kind: "permission",
    title: `${event.tool_name ?? "Tool"}: ${summary}`,
    body: { tool_name: event.tool_name, tool_input: event.tool_input },
    options: [{ label: "Allow" }, { label: "Deny" }],
  };
}

type Resolution = { choice: string | null; answers: Record<string, string> | null; custom: string | null };

export function mapResolutionToHookOutput(event: HookEvent, resolution: unknown): object | null {
  const r = resolution as Resolution;
  if (event.tool_name === "AskUserQuestion") {
    const questions = (event.tool_input?.questions ?? []) as Array<{ question: string }>;
    const answers = r.answers ?? (r.choice && questions[0] ? { [questions[0].question]: r.choice } : null);
    if (!answers && !r.custom) return null;
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedInput: { ...event.tool_input, answers: answers ?? { [questions[0]?.question ?? "answer"]: r.custom } },
        },
      },
    };
  }
  if (r.choice === "Allow")
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
  if (r.choice === "Deny")
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: r.custom ?? "Denied by the boss via Redstone Cowork" } } };
  return null;
}
```

- [ ] **Step 4: Extend handler test** — add to `handler.test.ts`:
```ts
it("PermissionRequest blocks, then outputs hook JSON from resolution", async () => {
  const deps = baseDeps({
    api: { ...baseDeps().api,
      awaitResolution: vi.fn().mockResolvedValue({ resolution: { choice: "Allow", answers: null, custom: null } }) },
  });
  const out = await processEvent(
    ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } }), deps);
  expect(JSON.stringify(out)).toContain("allow");
});

it("PermissionRequest timeout -> null (terminal fallback)", async () => {
  const out = await processEvent(ev("PermissionRequest", { tool_name: "Bash", tool_input: {} }), baseDeps());
  expect(out).toBeNull();
});
```

- [ ] **Step 5:** all hook-cli tests PASS, build clean. **Step 6: Commit** `feat(hook-cli): blocking permission/question round-trip with terminal fallback`

---

### Task 9: web — login, proxies, live sessions + decisions UI

**Files:**
- Create: `apps/web/app/login/page.tsx`, `apps/web/app/api/login/route.ts`
- Create: `apps/web/app/api/proxy/[...path]/route.ts`, `apps/web/app/api/stream/route.ts`
- Create: `apps/web/lib/api.ts`, `apps/web/components/DecisionCard.tsx`, `apps/web/components/SessionRow.tsx`
- Modify: `apps/web/app/page.tsx`

Design: instance token entered once on `/login` → validated against API → stored as httpOnly cookie `rcw_token`. All browser calls go through Next route handlers that read the cookie and add the Bearer header; the token never reaches client JS. The home page is a client component: loads sessions + pending decisions, subscribes to `/api/stream` (SSE proxy), resolves decisions with option buttons or custom text.

- [ ] **Step 1: server-side helper** — `apps/web/lib/api.ts`

```ts
import { cookies } from "next/headers";

export const API_URL = process.env.API_INTERNAL_URL ?? "http://api:3001";

export async function tokenFromCookie(): Promise<string | null> {
  return (await cookies()).get("rcw_token")?.value ?? null;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenFromCookie();
  if (!token) return new Response("unauthorized", { status: 401 });
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
}
```

- [ ] **Step 2: login** — `apps/web/app/api/login/route.ts`

```ts
import { NextResponse } from "next/server";
import { API_URL } from "../../../lib/api";

export async function POST(req: Request) {
  const { token } = await req.json();
  const probe = await fetch(`${API_URL}/sessions`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!probe.ok) return NextResponse.json({ ok: false }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("rcw_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
```

`apps/web/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";

export default function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ token }), headers: { "Content-Type": "application/json" } });
    if (r.ok) window.location.href = "/";
    else setError("Invalid token");
  };
  return (
    <main style={{ maxWidth: 380, margin: "10vh auto" }}>
      <h1>Redstone Cowork</h1>
      <p>Enter your instance token (from the server&apos;s .env):</p>
      <input type="password" value={token} onChange={(e) => setToken(e.target.value)}
        style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #2a3550", background: "#131a2e", color: "inherit" }} />
      <button onClick={submit} style={{ marginTop: 12, padding: "12px 24px", borderRadius: 8, border: 0, background: "#3b6ef6", color: "white", width: "100%" }}>
        Sign in
      </button>
      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
    </main>
  );
}
```

- [ ] **Step 3: proxies**

`apps/web/app/api/proxy/[...path]/route.ts`:
```ts
import { apiFetch } from "../../../../lib/api";

const ALLOWED = [/^sessions$/, /^decisions$/, /^decisions\/[\w-]+\/resolve$/];

async function forward(req: Request, params: Promise<{ path: string[] }>, method: string) {
  const { path } = await params;
  const joined = path.join("/");
  if (!ALLOWED.some((re) => re.test(joined))) return new Response("forbidden", { status: 403 });
  const url = new URL(req.url);
  const body = method === "POST" ? await req.text() : undefined;
  return apiFetch(`/${joined}${url.search}`, { method, body });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params, "GET");
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params, "POST");
}
```

`apps/web/app/api/stream/route.ts` (SSE pass-through):
```ts
import { apiFetch } from "../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = await apiFetch("/stream");
  if (!upstream.ok || !upstream.body) return new Response("unauthorized", { status: 401 });
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 4: UI components**

`apps/web/components/DecisionCard.tsx`:
```tsx
"use client";
import { useState } from "react";

type Option = { label: string; description?: string };
export type Decision = {
  id: string; sessionId: string; kind: string; title: string;
  options: Option[]; createdAt: string;
};

export function DecisionCard({ decision, onResolved }: { decision: Decision; onResolved: (id: string) => void }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async (choice: string | null) => {
    setBusy(true);
    const r = await fetch(`/api/proxy/decisions/${decision.id}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice, answers: null, custom: custom || null }),
    });
    if (r.ok || r.status === 409) onResolved(decision.id);
    setBusy(false);
  };

  const card: React.CSSProperties = { background: "#131a2e", border: "1px solid #233052", borderRadius: 12, padding: 16, marginBottom: 12 };
  return (
    <div style={card}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{decision.kind} · session {decision.sessionId.slice(0, 8)} · {new Date(decision.createdAt).toLocaleTimeString()}</div>
      <div style={{ margin: "8px 0", fontWeight: 600 }}>{decision.title}</div>
      {decision.kind === "permission" || decision.kind === "question" ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {decision.options.map((o) => (
              <button key={o.label} disabled={busy} onClick={() => resolve(o.label)} title={o.description}
                style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: o.label === "Deny" ? "#5a2330" : "#3b6ef6", color: "white" }}>
                {o.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input placeholder="Custom reply…" value={custom} onChange={(e) => setCustom(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #2a3550", background: "#0e1424", color: "inherit" }} />
            <button disabled={busy || !custom} onClick={() => resolve(null)}
              style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#2a3550", color: "white" }}>Send</button>
          </div>
        </>
      ) : (
        <button disabled={busy} onClick={() => resolve("Acknowledged")}
          style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#2a3550", color: "white" }}>Acknowledge</button>
      )}
    </div>
  );
}
```

`apps/web/components/SessionRow.tsx`:
```tsx
const COLORS: Record<string, string> = { active: "#3ddc84", waiting: "#f6c945", stale: "#8a93a6", lost: "#ff6b6b" };

export function SessionRow({ s }: { s: { id: string; machine: string; cwd: string; status: string; pendingDecisions: number } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #1b2440" }}>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: COLORS[s.status] ?? "#888" }} />
      <code style={{ opacity: 0.8 }}>{s.id.slice(0, 8)}</code>
      <span>{s.machine}</span>
      <span style={{ opacity: 0.6, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.cwd}</span>
      <span>{s.status}{s.pendingDecisions > 0 ? ` · ${s.pendingDecisions} pending` : ""}</span>
    </div>
  );
}
```

- [ ] **Step 5: Home page** — replace `apps/web/app/page.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { DecisionCard, type Decision } from "../components/DecisionCard";
import { SessionRow } from "../components/SessionRow";

type Session = { id: string; machine: string; cwd: string; status: string; pendingDecisions: number };

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);

  const refresh = useCallback(async () => {
    const [s, d] = await Promise.all([fetch("/api/proxy/sessions"), fetch("/api/proxy/decisions?status=pending")]);
    if (s.status === 401 || d.status === 401) { window.location.href = "/login"; return; }
    setSessions(await s.json());
    setDecisions(await d.json());
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource("/api/stream");
    es.onmessage = () => refresh();
    const poll = setInterval(refresh, 30_000); // safety net
    return () => { es.close(); clearInterval(poll); };
  }, [refresh]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>Situation Room <span style={{ fontSize: 14, opacity: 0.5 }}>(M1 preview)</span></h1>
      <h2 style={{ fontSize: 16, opacity: 0.8 }}>Decisions waiting on you {decisions.length > 0 && `(${decisions.length})`}</h2>
      {decisions.length === 0 && <p style={{ opacity: 0.5 }}>All clear, boss.</p>}
      {decisions.map((d) => <DecisionCard key={d.id} decision={d} onResolved={() => refresh()} />)}
      <h2 style={{ fontSize: 16, opacity: 0.8, marginTop: 32 }}>Sessions</h2>
      {sessions.length === 0 && <p style={{ opacity: 0.5 }}>No sessions attached. Run <code>redstone hook</code> in a project.</p>}
      {sessions.map((s) => <SessionRow key={s.id} s={s} />)}
    </main>
  );
}
```

- [ ] **Step 6:** `pnpm --filter @rcw/web build` clean. **Step 7: Commit** `feat(web): token login + live sessions/decisions UI over SSE`

---

### Task 10: Deploy, live round-trip verification, report

- [ ] **Step 1:** `pnpm build && pnpm test` all green locally (M0 + new suites).
- [ ] **Step 2:** `deploy/remote.sh up` — rebuild + restart stack on dev server; `deploy/remote.sh smoke` still green (M0 regression).
- [ ] **Step 3: API-level round-trip on the server** (scripted): create session + permission decision via curl, long-poll `await` in background, resolve from a second curl, confirm the poller got the resolution.
- [ ] **Step 4: Real Claude Code round-trip** (the M1a exit criterion — guided with the user):
  1. On the user's Mac: `pnpm --filter @rcw/hook-cli build && node apps/hook-cli/dist/main.js init --server http://<server>:47101 --token <token>` (or via SSH tunnel `ssh -L 47101:localhost:47101 …`).
  2. In any project: `node apps/hook-cli/dist/main.js hook` → start/continue a Claude Code session → trigger a permission prompt.
  3. Open the web UI (phone or desktop) → decision card appears → tap Allow → Claude proceeds.
  4. **Schema verification:** run with `claude --debug hooks` once; if the `PermissionRequest` payload/response shape differs from `hook-output.ts` assumptions, fix the mapping THERE (expected deviation point), re-test, commit `fix(hook-cli): align hook output schema with live Claude Code`.
- [ ] **Step 5:** Update `docs/TECH-DEBT.md` (clear items fixed by Task 2's pool work), tick M1a items in PRD 001 acceptance list if met.
- [ ] **Step 6:** Push; Jira RCW-3 comment + status; Mattermost update.

---

## Self-Review Notes

- **Spec coverage:** PRD 001 FR-1..FR-12 — FR-1/2 (init + per-session attach via arming) T6; FR-3 (hooks install, no inbound ports — outbound long-poll only) T6-8; FR-4 (registry with machine/cwd, liveness semantics revised per spike) T2; FR-5/6 (capture: completed/question/permission; options incl. custom) T7/8; FR-7 (project mapping) deferred to M2/M3 — sessions render unmapped, per plan scope; FR-8 web SSE ✓ T5/T9, mobile push → M1b; FR-9 exactly-once T4; FR-10/11 revised by spike (hook-gate; timeout → terminal fallback instead of "injection failed" reporting) — documented in PRD amendment; FR-12 sessions list T9 (web; mobile M1b).
- **Types consistent** across tasks (Decision/Resolution from @rcw/shared everywhere; handler Deps narrow interface).
- **Placeholder scan:** hook-output.ts is explicitly a verify-live deviation point (Task 10 Step 4), not a TBD.

---

# REVISED TASKS (2026-06-07 pivot: notify-only hooks + tmux delivery)

**Revised conventions:**
- Hooks NEVER block: handler does its API calls (≤3s timeouts) and exits; settings hook `timeout: 10`.
- Installed hook events now: `SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`, `PermissionRequest`, `PostToolUse`, `SessionEnd`.
- Delivery channel: a poller (hidden tmux window, started by `redstone-claude`) long-polls `GET /sessions/by-wrapper/:wrapperId/deliveries` and executes `tmux send-keys`.
- `apps/hook-cli/src/keymap.ts` is the ONLY module that knows terminal keystroke mappings — it is the verify-live deviation point (Task 10).
- Wrapper sessions are identified by `RCW_WRAPPER_ID` env (set on the tmux session; inherited by claude; inherited by hook commands).
- Non-wrapper sessions (attached via `redstone hook` arming) get info-only decision cards (`deliverable: false` in body) — visible, not remotely answerable.
- Windows: `redstone-claude` requires tmux → document WSL2; `redstone hook` (notify-only) works everywhere.

### Task 5b: API — delivery queue (instructions, undelivered resolutions, local auto-resolve)

**Files:**
- Modify: `packages/shared/src/decisions/decision.ts` (add `"instruction"` kind; add `deliveredAt`), `packages/shared/src/sessions/agent-session.ts` (add `wrapperId` nullable to both schemas), `packages/shared/test/decision.test.ts` (extend)
- Create: `apps/api/migrations/003_deliveries.sql`, `apps/api/src/application/delivery-waiters.ts`
- Modify: decision-store port + both adapters (`listUndelivered`, `markDelivered`, `resolveAllPendingLocal`), session-store port + adapters (`getByWrapper`), `decisions.service.ts`, `sessions.controller.ts`, `decisions.controller.ts`, `app.module.ts`
- Test: `apps/api/test/deliveries.e2e.test.ts`

- [ ] **Step 1: Migration** — `apps/api/migrations/003_deliveries.sql`

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS wrapper_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_wrapper ON sessions (wrapper_id);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_decisions_undelivered ON decisions (session_id) WHERE status = 'resolved' AND delivered_at IS NULL;
```

- [ ] **Step 2: Shared schema changes (failing test first)** — extend `packages/shared/test/decision.test.ts`:

```ts
it("accepts instruction kind and deliveredAt", () => {
  const d = DecisionSchema.parse({
    id: "9f3b8c1e-2a4d-4f6a-9c0d-1e2f3a4b5c6d", sessionId: "s", kind: "instruction",
    title: "run tests", body: {}, options: [], status: "resolved",
    createdAt: "2026-06-07T10:00:00Z", resolvedAt: "2026-06-07T10:00:01Z",
    resolution: { choice: null, answers: null, custom: "pnpm test" }, deliveredAt: null,
  });
  expect(d.deliveredAt).toBeNull();
});
it("agent session carries optional wrapperId", () => {
  const s = NewAgentSessionSchema.parse({ id: "x", machine: "m", cwd: "/p", gitBranch: null, wrapperId: "ab12" });
  expect(s.wrapperId).toBe("ab12");
});
```
Schema edits: `DecisionKindSchema` → `z.enum(["permission","question","completion","notification","instruction"])`; `DecisionSchema` gains `deliveredAt: z.coerce.date().nullable().default(null)`; `AgentSessionSchema` gains `wrapperId: z.string().nullable().default(null)` and `NewAgentSessionSchema` picks it too.

- [ ] **Step 3: API failing test** — `apps/api/test/deliveries.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("delivery queue", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-w", machine: "m", cwd: "/p", gitBranch: null, wrapperId: "wrap1" });
  });
  afterAll(() => app.close());

  it("finds session by wrapper id", async () => {
    const r = await request(app.getHttpServer()).get("/sessions/by-wrapper/wrap1").set(auth).expect(200);
    expect(r.body.id).toBe("sess-w");
    await request(app.getHttpServer()).get("/sessions/by-wrapper/nope").set(auth).expect(404);
  });

  it("instruct creates a pre-resolved instruction that appears in deliveries, ack removes it", async () => {
    await request(app.getHttpServer()).post("/sessions/sess-w/instruct").set(auth)
      .send({ text: "pnpm test" }).expect(201);
    const del = await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=500").set(auth).expect(200);
    expect(del.body[0].kind).toBe("instruction");
    expect(del.body[0].resolution.custom).toBe("pnpm test");
    await request(app.getHttpServer()).post(`/decisions/${del.body[0].id}/delivered`).set(auth).expect(200);
    await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=300").set(auth).expect(204);
  });

  it("resolving a pending decision wakes the deliveries long-poll", async () => {
    const d = await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-w", kind: "permission", title: "t", options: [{ label: "Allow" }] });
    const poll = request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=5000").set(auth);
    await new Promise((r) => setTimeout(r, 150));
    await request(app.getHttpServer()).post(`/decisions/${d.body.id}/resolve`).set(auth).send({ choice: "Allow" });
    const res = await poll;
    expect(res.status).toBe(200);
    expect(res.body.some((x: { id: string }) => x.id === d.body.id)).toBe(true);
    await request(app.getHttpServer()).post(`/decisions/${d.body.id}/delivered`).set(auth);
  });

  it("resolve-local resolves all pending permission/question decisions as answered-at-terminal and marks them delivered", async () => {
    const d = await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-w", kind: "permission", title: "t2", options: [{ label: "Allow" }] });
    await request(app.getHttpServer()).post("/sessions/sess-w/resolve-local").set(auth).expect(200);
    await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=300").set(auth).expect(204);
    const pending = await request(app.getHttpServer()).get("/decisions?status=pending").set(auth);
    expect(pending.body.some((x: { id: string }) => x.id === d.body.id)).toBe(false);
  });
});
```

- [ ] **Step 4: Implement**

`apps/api/src/application/delivery-waiters.ts` (mirror of DecisionWaiters keyed by sessionId):
```ts
import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

@Injectable()
export class DeliveryWaiters {
  private readonly emitter = new EventEmitter().setMaxListeners(1000);
  notify(sessionId: string) { this.emitter.emit(sessionId); }
  wait(sessionId: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.emitter.off(sessionId, on); resolve(false); }, ms);
      const on = () => { clearTimeout(timer); resolve(true); };
      this.emitter.once(sessionId, on);
    });
  }
}
```

DecisionStore port additions (+ both adapters):
```ts
listUndelivered(sessionId: string): Promise<Decision[]>;           // status='resolved' AND deliveredAt null AND kind IN permission|question|instruction
markDelivered(id: string, at: Date): Promise<void>;
resolveAllPendingLocal(sessionId: string, at: Date): Promise<number>; // pending permission|question -> resolved {choice:"__local__"} + delivered_at=at
```
Postgres `resolveAllPendingLocal`:
```sql
UPDATE decisions SET status='resolved', resolution='{"choice":"__local__","answers":null,"custom":null}'::jsonb,
  resolved_at=$2, delivered_at=$2
WHERE session_id=$1 AND status='pending' AND kind IN ('permission','question')
```
SessionStore addition: `getByWrapper(wrapperId: string): Promise<AgentSession | null>` (both adapters; pg: `WHERE wrapper_id=$1 ORDER BY last_seen_at DESC LIMIT 1`). Postgres session ROW/INSERT/UPDATE gains `wrapper_id`.

`DecisionsService` additions (inject DeliveryWaiters; resolve() now also `deliveryWaiters.notify(resolved.sessionId)`):
```ts
async instruct(sessionId: string, input: unknown): Promise<Decision> {
  const { text } = z.object({ text: z.string().min(1) }).parse(input);
  if (!(await this.sessions.get(sessionId))) throw new NotFoundException("unknown session");
  const now = new Date();
  const decision: Decision = {
    sessionId, kind: "instruction", title: text.slice(0, 120), body: {}, options: [],
    id: randomUUID(), status: "resolved", createdAt: now, resolvedAt: now,
    resolution: { choice: null, answers: null, custom: text }, deliveredAt: null,
  };
  const created = await this.store.create(decision);
  this.deliveryWaiters.notify(sessionId);
  this.bus.emit({ type: "decision.created", payload: created });
  return created;
}
async deliveries(sessionId: string, timeoutMs: number): Promise<Decision[]> {
  const existing = await this.store.listUndelivered(sessionId);
  if (existing.length > 0) return existing;
  await this.deliveryWaiters.wait(sessionId, Math.min(timeoutMs, 30_000));
  return this.store.listUndelivered(sessionId);
}
markDelivered(id: string) { return this.store.markDelivered(id, new Date()); }
resolveLocal(sessionId: string) { return this.store.resolveAllPendingLocal(sessionId, new Date()); }
```
(Note: `create` for instruction must persist `resolution`/`resolvedAt`/`deliveredAt` — extend the Postgres `create` INSERT to include `resolution`, `resolved_at`, `delivered_at` columns.)

Controllers:
- `SessionsController`: `GET by-wrapper/:wrapperId` (404 when none), `GET :id/deliveries?timeoutMs` (200 array | 204 via @Res), `POST :id/instruct`, `POST :id/resolve-local` (@HttpCode(200), returns `{resolved: n}`). NOTE route order: declare `by-wrapper/:wrapperId` BEFORE `:id/...` routes.
- `DecisionsController`: `POST :id/delivered` (@HttpCode(200)).

- [ ] **Step 5:** shared + api tests all pass; builds clean.
- [ ] **Step 6: Commit** `feat(api): delivery queue (instructions, undelivered resolutions, local auto-resolve)`

### Task 6R: hook-cli — scaffold, installer, arming, `redstone-claude` wrapper

Same scaffold/config/state/installer as the superseded Task 6 with these changes, plus the wrapper:
- `installer.ts` `HOOK_EVENTS` = `["SessionStart","UserPromptSubmit","Stop","Notification","PermissionRequest","PostToolUse","SessionEnd"]`, `HOOK_TIMEOUT_S = 10`.
- `package.json` bin: `{ "redstone": "./dist/main.js", "redstone-claude": "./dist/claude-wrapper.js" }`.
- `main.ts` router gains `poll` subcommand (Task 8R) — for THIS task add the case with a stub that exits 0.
- Keep installer/arming tests from the superseded task (they remain valid, with the new event list asserted).

Additional file `apps/hook-cli/src/claude-wrapper.ts`:
```ts
#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { argv, exit } from "node:process";
import { loadCliConfig } from "./config";
import { installHooks } from "./installer";

const shq = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;

function main() {
  if (!loadCliConfig()) { console.error("run `redstone init --server <url> --token <token>` first"); exit(1); }
  if (spawnSync("tmux", ["-V"], { stdio: "ignore" }).error) {
    console.error("redstone-claude requires tmux (on Windows: run inside WSL2). Install tmux and retry."); exit(1);
  }
  const wrapperId = randomBytes(4).toString("hex");
  const session = `rcw-${wrapperId}`;
  const wrapperBin = realpathSync(argv[1]);
  const mainBin = wrapperBin.replace(/claude-wrapper\.js$/, "main.js");
  installHooks(process.cwd(), `node ${mainBin}`);
  const claudeCmd = `RCW_WRAPPER_ID=${wrapperId} claude ${argv.slice(2).map(shq).join(" ")}`;
  execFileSync("tmux", ["new-session", "-d", "-s", session, "-c", process.cwd(), claudeCmd]);
  execFileSync("tmux", ["set-option", "-t", session, "status", "off"]);
  execFileSync("tmux", ["new-window", "-d", "-t", session,
    `node ${mainBin} poll --wrapper ${wrapperId} --tmux ${session}:0`]);
  // foreground: user lives inside the claude window; on exit, clean up the whole session
  spawnSync("tmux", ["attach", "-t", `${session}:0`], { stdio: "inherit" });
  spawnSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" });
}
main();
```
Wrapper test (`test/claude-wrapper.test.ts`): unit-test `shq` quoting via export, and that the module composes the expected tmux args (refactor arg-building into exported `buildTmuxCommands(wrapperId, cwd, args, mainBin)` returning the arg arrays, so it's testable without tmux; `main()` just executes them).

Commit: `feat(hook-cli): scaffold, installer, redstone-claude tmux wrapper`

### Task 7R: hook-cli — notify-only handler

Same `api-client.ts` + `handler.ts` structure as the superseded Task 7, with these changes:
- ApiClient drops `awaitResolution`, gains `resolveLocal(sessionId)` (POST `/sessions/:id/resolve-local`, 2s timeout) — and `attach` payload includes `wrapperId: string | null`.
- `Deps` gains `wrapperId: string | null` (from `process.env.RCW_WRAPPER_ID ?? null` in `handle()`).
- `processEvent` logic:
  - unknown session → attach when `deps.wrapperId` is set OR `isArmed(cwd)` (disarm after armed attach); else silent null.
  - `PermissionRequest` → `createDecision` (kind `question` if `tool_name === "AskUserQuestion"` with title/options extracted from `tool_input.questions[0]`, else kind `permission` with `[Allow, Deny]` options and `${tool_name}: <160-char input summary>` title; body includes `tool_input` and `deliverable: !!deps.wrapperId`) → **return null immediately** (never block).
  - `PostToolUse` → `api.resolveLocal(session_id)` → null. (Covers "user answered at the terminal" — any pending permission/question cards for this session resolve as `__local__`.)
  - `Stop` → completion notification decision (as before). `Notification` → notification decision (as before). Others → heartbeat only.
- The decision-spec extraction lives in `apps/hook-cli/src/decision-spec.ts` (exported `buildDecisionSpec(event)`) — unit-tested with the same cases as the superseded Task 8's `buildBlockingDecision` tests (permission → Allow/Deny; AskUserQuestion → options carried; returns null when no questions).
- Handler tests: adapt the superseded Task 7 tests (unattached+unarmed no-op; armed attach+disarm; NEW: wrapperId attach without arming; Stop → completion; PostToolUse → resolveLocal called; PermissionRequest → createDecision called AND returns null without awaiting; api down → silent null).

Commit: `feat(hook-cli): notify-only handler with local auto-resolve`

### Task 8R: hook-cli — keymap + delivery poller

**Files:**
- Create: `apps/hook-cli/src/keymap.ts`, `apps/hook-cli/src/poller.ts`
- Modify: `apps/hook-cli/src/main.ts` (wire `poll`), `apps/hook-cli/src/api-client.ts`
- Test: `apps/hook-cli/test/keymap.test.ts`, `apps/hook-cli/test/poller.test.ts`

- [ ] **Step 1: Failing tests**

`test/keymap.test.ts`:
```ts
import { deliveryToKeys } from "../src/keymap";

const base = { id: "d1", sessionId: "s", title: "t", body: {}, status: "resolved", createdAt: new Date().toISOString(), resolvedAt: null, deliveredAt: null };

describe("deliveryToKeys", () => {
  it("instruction -> literal text + Enter", () => {
    expect(deliveryToKeys({ ...base, kind: "instruction", options: [], resolution: { choice: null, answers: null, custom: "pnpm test" } } as never))
      .toEqual([["-l", "pnpm test"], ["Enter"]]);
  });
  it("permission Allow -> digit of the option position", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }, { label: "Deny" }], resolution: { choice: "Allow", answers: null, custom: null } } as never))
      .toEqual([["1"]]);
  });
  it("question option pick -> its digit", () => {
    expect(deliveryToKeys({ ...base, kind: "question", options: [{ label: "A" }, { label: "B" }], resolution: { choice: "B", answers: null, custom: null } } as never))
      .toEqual([["2"]]);
  });
  it("local-answered or unmapped -> null (skip)", () => {
    expect(deliveryToKeys({ ...base, kind: "permission", options: [{ label: "Allow" }], resolution: { choice: "__local__", answers: null, custom: null } } as never)).toBeNull();
    expect(deliveryToKeys({ ...base, kind: "question", options: [], resolution: { choice: null, answers: null, custom: "free text" } } as never)).toBeNull();
  });
});
```

`test/poller.test.ts` (inject deps; no real tmux):
```ts
import { pollOnce } from "../src/poller";

describe("pollOnce", () => {
  it("sends keys for each delivery and acks", async () => {
    const sent: string[][][] = [];
    const acked: string[] = [];
    const deps = {
      api: {
        deliveries: vi.fn().mockResolvedValue([
          { id: "d1", kind: "instruction", options: [], resolution: { choice: null, answers: null, custom: "hello" } },
        ]),
        markDelivered: vi.fn().mockImplementation(async (id: string) => { acked.push(id); }),
      },
      sendKeys: async (keys: string[]) => { sent.push([keys]); },
      wrapperId: "w1",
    } as never;
    await pollOnce(deps);
    expect(sent.length).toBeGreaterThan(0);
    expect(acked).toEqual(["d1"]);
  });
  it("acks but does not send for skipped deliveries", async () => {
    const deps = {
      api: {
        deliveries: vi.fn().mockResolvedValue([
          { id: "d2", kind: "question", options: [], resolution: { choice: null, answers: null, custom: "free" } },
        ]),
        markDelivered: vi.fn(),
      },
      sendKeys: vi.fn(),
      wrapperId: "w1",
    } as never;
    await pollOnce(deps);
    expect((deps as never as { sendKeys: ReturnType<typeof vi.fn> }).sendKeys).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

`src/keymap.ts`:
```ts
// ⚠️ The ONLY module that knows Claude Code's terminal keystroke mappings.
// Verified live in Task 10 — adjust HERE if the real dialogs differ.
type Option = { label: string };
type Delivery = { kind: string; options: Option[]; resolution: { choice: string | null; answers: Record<string, string> | null; custom: string | null } | null };

export function deliveryToKeys(d: Delivery): string[][] | null {
  const r = d.resolution;
  if (!r || r.choice === "__local__") return null;
  if (d.kind === "instruction" && r.custom) return [["-l", r.custom], ["Enter"]];
  if ((d.kind === "permission" || d.kind === "question") && r.choice) {
    const idx = d.options.findIndex((o) => o.label === r.choice);
    if (idx >= 0) return [[String(idx + 1)]];
  }
  return null; // unmapped (e.g. free-text answer to a dialog) — M1a limitation, ack + skip
}
```

`src/api-client.ts` additions:
```ts
async sessionByWrapper(wrapperId: string): Promise<{ id: string } | null> {
  const r = await this.req(`/sessions/by-wrapper/${encodeURIComponent(wrapperId)}`, { headers: json(this.cfg.token) }, 3000);
  return r.ok ? r.json() : null;
}
async deliveries(sessionId: string, timeoutMs: number): Promise<Array<Record<string, unknown>>> {
  const r = await this.req(`/sessions/${encodeURIComponent(sessionId)}/deliveries?timeoutMs=${timeoutMs}`,
    { headers: json(this.cfg.token) }, timeoutMs + 5000);
  return r.status === 200 ? r.json() : [];
}
async markDelivered(id: string): Promise<void> {
  await this.req(`/decisions/${id}/delivered`, { method: "POST", headers: json(this.cfg.token) }, 3000);
}
```

`src/poller.ts`:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deliveryToKeys } from "./keymap";
import type { ApiClient } from "./api-client";
const execFileP = promisify(execFile);

export type PollerDeps = {
  api: Pick<ApiClient, "deliveries" | "markDelivered"> & { sessionId: string };
  sendKeys: (keys: string[]) => Promise<void>;
};

export async function pollOnce(deps: { api: { deliveries(s: string, t: number): Promise<never[]>; markDelivered(id: string): Promise<void> }; sendKeys: (k: string[]) => Promise<void>; sessionId: string }) {
  const items = await deps.api.deliveries(deps.sessionId, 25_000);
  for (const d of items as Array<{ id: string } & Parameters<typeof deliveryToKeys>[0]>) {
    const keys = deliveryToKeys(d);
    if (keys) for (const k of keys) await deps.sendKeys(k);
    await deps.api.markDelivered(d.id);
  }
}

export async function runPoller(opts: { wrapperId: string; tmuxTarget: string; api: ApiClient }) {
  const sendKeys = async (keys: string[]) => {
    await execFileP("tmux", ["send-keys", "-t", opts.tmuxTarget, ...keys]);
  };
  // wait for the hook handler to register the session (first claude activity)
  let sessionId: string | null = null;
  while (!sessionId) {
    const s = await opts.api.sessionByWrapper(opts.wrapperId).catch(() => null);
    if (s) sessionId = s.id;
    else await new Promise((r) => setTimeout(r, 3000));
  }
  for (;;) {
    try { await pollOnce({ api: { deliveries: (s, t) => opts.api.deliveries(s, t) as never, markDelivered: (id) => opts.api.markDelivered(id) }, sendKeys, sessionId }); }
    catch { await new Promise((r) => setTimeout(r, 5000)); }
  }
}
```
(Implementer may simplify the pollOnce/PollerDeps typing — keep the two unit tests passing and the runPoller loop semantics: register-wait → infinite poll with 5s error backoff.)

`main.ts` `poll` case:
```ts
} else if (cmd === "poll") {
  const cfg = loadCliConfig();
  const wrapper = argv[argv.indexOf("--wrapper") + 1];
  const tmux = argv[argv.indexOf("--tmux") + 1];
  if (!cfg || !wrapper || !tmux) exit(0);
  const { runPoller } = await import("./poller");
  const { ApiClient } = await import("./api-client");
  await runPoller({ wrapperId: wrapper, tmuxTarget: tmux, api: new ApiClient(cfg) });
}
```

- [ ] **Step 3:** all hook-cli tests pass, build clean.
- [ ] **Step 4: Commit** `feat(hook-cli): keystroke keymap + tmux delivery poller`

### Task 9R: web — as original Task 9 PLUS per-session command box

Implement the original Task 9 in full, with these additions:
1. Proxy `ALLOWED` regexes add: `/^sessions\/[^/]+\/instruct$/`.
2. `SessionRow` gains an inline "send command" form (input + Send button) that POSTs `{text}` to `/api/proxy/sessions/<id>/instruct` — only rendered when `s.wrapperId` is truthy (sessions API now returns it).
3. `DecisionCard`: cards whose `body.deliverable === false` render options as disabled with a hint "attach via redstone-claude to answer remotely"; `completion`/`notification` cards keep Acknowledge.

Commit: `feat(web): token login + live decisions UI + remote command box`

### Task 10R: deploy + live tmux round-trip + report

- [ ] Local: `pnpm build && pnpm test` all green.
- [ ] `deploy/remote.sh up` + `smoke` (M0 regression).
- [ ] Scripted API check on server: attach fake session w/ wrapperId via curl, instruct, poll deliveries, ack (curl loop).
- [ ] **Live round-trip (with the user, on their Mac):** build hook-cli; `node dist/main.js init --server <url> --token <token>`; run `node dist/claude-wrapper.js` (or linked `redstone-claude`) in a test project; trigger a permission prompt; verify: card appears on web AND terminal dialog shows instantly (no blocking); answer from web → tmux receives the digit and Claude proceeds; answer another one locally → card auto-resolves "answered at terminal"; use the command box → text lands in the Claude prompt. **Adjust `keymap.ts` to observed dialog behavior** (digit vs arrow/enter — expected deviation point), commit fixes.
- [ ] Update PRD 001 amendment if mappings changed; update docs/TECH-DEBT.md; push; Jira RCW-3 + Mattermost updates.
