# M0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo + Docker Compose foundation where `docker compose up` on the dev server serves web + API on configurable ports with green healthchecks and one domain event persisted round-trip (PLAN.md M0 exit criteria).

**Architecture:** pnpm + Turborepo monorepo. NestJS API with hexagonal core (domain ports, adapters for HTTP/Postgres), plain-SQL migrations run on container start, Nunjucks (Jinja-compatible) prompt loader over `prompts/**/*.md`. Worker proves wiring by POSTing heartbeat events to the API. Next.js web shows instance status. Docker never runs on the Mac — `deploy/remote.sh` rsyncs to `ubuntu@18.143.147.28` and drives compose there over SSH.

**Tech Stack:** Node 22, pnpm 10, Turborepo, NestJS 11, Next.js 15, Zod, Nunjucks, pg (no ORM in M0), Vitest (+ unplugin-swc for Nest decorators), supertest, Postgres 16, Qdrant.

**Conventions locked here:**
- Internal container ports fixed: web `3000`, API `3001`. Host ports from `.env`: `WEB_PORT` (default 47100), `API_PORT` (47101).
- Instance naming via `COMPOSE_PROJECT_NAME=rcw-<INSTANCE_ID>` in `.env`.
- API auth: `Authorization: Bearer ${INSTANCE_TOKEN}` guard on all routes except `/health`.
- Unit tests run on the Mac (no Docker needed); integration/smoke runs on the dev server via `deploy/remote.sh`.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "redstone-cowork",
  "private": true,
  "packageManager": "pnpm@10.12.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

- [ ] **Step 4: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

- [ ] **Step 5: `.env.example`**

```bash
# ---- Instance identity (PRD 006 FR-1/FR-2) ----
INSTANCE_ID=default
COMPOSE_PROJECT_NAME=rcw-default

# ---- Ports (host-side; containers use fixed internal ports) ----
WEB_PORT=47100
API_PORT=47101

# ---- Secrets ----
POSTGRES_PASSWORD=change-me-postgres
INSTANCE_TOKEN=change-me-token
```

- [ ] **Step 6: Append build artifacts to `.gitignore`**

```
coverage/
*.tsbuildinfo
```

- [ ] **Step 7: Verify install works**

Run: `corepack enable && pnpm install`
Expected: lockfile created, no errors.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold (pnpm + turborepo)"
```

---

### Task 2: `packages/shared` — DomainEvent Zod schema (TDD)

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`, `packages/shared/src/events/domain-event.ts`
- Test: `packages/shared/test/domain-event.test.ts`

- [ ] **Step 1: Package files**

`packages/shared/package.json`:
```json
{
  "name": "@rcw/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.24.0" },
  "devDependencies": { "vitest": "^3.1.0" }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 2: Write the failing test** — `packages/shared/test/domain-event.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DomainEventSchema, NewDomainEventSchema } from "../src/events/domain-event";

describe("DomainEventSchema", () => {
  it("accepts a valid event", () => {
    const e = DomainEventSchema.parse({
      id: "9f3b8c1e-2a4d-4f6a-9c0d-1e2f3a4b5c6d",
      type: "worker.heartbeat",
      source: "worker",
      occurredAt: "2026-06-07T10:00:00Z",
      payload: { instance: "default" },
    });
    expect(e.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects empty type", () => {
    expect(() =>
      NewDomainEventSchema.parse({ type: "", source: "worker", payload: {} })
    ).toThrow();
  });

  it("defaults payload to empty object", () => {
    const e = NewDomainEventSchema.parse({ type: "t.created", source: "api" });
    expect(e.payload).toEqual({});
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @rcw/shared test`
Expected: FAIL — cannot resolve `../src/events/domain-event`.

- [ ] **Step 4: Implement** — `packages/shared/src/events/domain-event.ts`

```ts
import { z } from "zod";

/** Unified envelope every signal in the system normalizes into (PRD 002 FR-2 grows from this). */
export const NewDomainEventSchema = z.object({
  type: z.string().min(1),    // e.g. "worker.heartbeat", "jira.issue.updated"
  source: z.string().min(1),  // e.g. "worker", "api", "connector:jira"
  payload: z.record(z.unknown()).default({}),
});

export const DomainEventSchema = NewDomainEventSchema.extend({
  id: z.string().uuid(),
  occurredAt: z.coerce.date(),
});

export type NewDomainEvent = z.infer<typeof NewDomainEventSchema>;
export type DomainEvent = z.infer<typeof DomainEventSchema>;
```

`packages/shared/src/index.ts`:
```ts
export * from "./events/domain-event";
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm install && pnpm --filter @rcw/shared test`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(shared): DomainEvent zod schemas"
```

---

### Task 3: `apps/api` — NestJS skeleton with /health (TDD)

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/infrastructure/config.ts`
- Create: `apps/api/src/adapters/http/health.controller.ts`
- Test: `apps/api/test/health.e2e.test.ts`

- [ ] **Step 1: Package files**

`apps/api/package.json`:
```json
{
  "name": "@rcw/api",
  "version": "0.0.1",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@rcw/shared": "workspace:*",
    "nunjucks": "^3.2.4",
    "pg": "^8.13.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.0",
    "uuid": "^11.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.0.0",
    "@swc/core": "^1.7.0",
    "@types/express": "^5.0.0",
    "@types/nunjucks": "^3.2.6",
    "@types/pg": "^8.11.0",
    "@types/supertest": "^6.0.0",
    "supertest": "^7.0.0",
    "unplugin-swc": "^1.5.0",
    "vitest": "^3.1.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "module": "CommonJS", "moduleResolution": "Node" },
  "include": ["src"]
}
```

`apps/api/vitest.config.ts` (swc needed for Nest decorator metadata):
```ts
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], globals: true },
  plugins: [swc.vite({ module: { type: "commonjs" } })],
});
```

- [ ] **Step 2: Config from env** — `apps/api/src/infrastructure/config.ts`

```ts
import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  INSTANCE_TOKEN: z.string().min(1).default("dev-token"),
  PROMPTS_DIR: z.string().default("prompts"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export const loadConfig = (): AppConfig => ConfigSchema.parse(process.env);
```

- [ ] **Step 3: Write the failing e2e test** — `apps/api/test/health.e2e.test.ts`

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("GET /health", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("returns ok without auth", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @rcw/api test`
Expected: FAIL — `AppModule` not found.

- [ ] **Step 5: Implement**

`apps/api/src/adapters/http/health.controller.ts`:
```ts
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "api" };
  }
}
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { HealthController } from "./adapters/http/health.controller";

@Module({ controllers: [HealthController] })
export class AppModule {}
```

`apps/api/src/main.ts`:
```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./infrastructure/config";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);
  await app.listen(config.PORT);
  console.log(`[api] listening on :${config.PORT}`);
}
bootstrap();
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm install && pnpm --filter @rcw/api test`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(api): nestjs skeleton with /health"
```

---

### Task 4: Hexagonal core — EventStore port + RecordEvent use case (TDD)

**Files:**
- Create: `apps/api/src/domain/events/event-store.port.ts`
- Create: `apps/api/src/application/record-event.use-case.ts`
- Create: `apps/api/src/adapters/persistence/in-memory-event-store.ts`
- Test: `apps/api/test/record-event.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/api/test/record-event.test.ts`

```ts
import { RecordEventUseCase } from "../src/application/record-event.use-case";
import { InMemoryEventStore } from "../src/adapters/persistence/in-memory-event-store";

describe("RecordEventUseCase", () => {
  it("validates, stamps id+time, persists, returns the event", async () => {
    const store = new InMemoryEventStore();
    const useCase = new RecordEventUseCase(store);
    const event = await useCase.execute({ type: "test.ping", source: "test", payload: { n: 1 } });
    expect(event.id).toMatch(/[0-9a-f-]{36}/);
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(await store.list()).toHaveLength(1);
  });

  it("rejects invalid input", async () => {
    const useCase = new RecordEventUseCase(new InMemoryEventStore());
    await expect(useCase.execute({ type: "", source: "x" } as never)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @rcw/api test record-event`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/domain/events/event-store.port.ts` (the port — domain owns the interface):
```ts
import type { DomainEvent } from "@rcw/shared";

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  list(limit?: number): Promise<DomainEvent[]>;
}

export const EVENT_STORE = Symbol("EventStore");
```

`apps/api/src/application/record-event.use-case.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common";
import { NewDomainEventSchema, type DomainEvent } from "@rcw/shared";
import { randomUUID } from "node:crypto";
import { EVENT_STORE, type EventStore } from "../domain/events/event-store.port";

@Injectable()
export class RecordEventUseCase {
  constructor(@Inject(EVENT_STORE) private readonly store: EventStore) {}

  async execute(input: unknown): Promise<DomainEvent> {
    const parsed = NewDomainEventSchema.parse(input);
    const event: DomainEvent = { ...parsed, id: randomUUID(), occurredAt: new Date() };
    await this.store.append(event);
    return event;
  }
}
```

`apps/api/src/adapters/persistence/in-memory-event-store.ts`:
```ts
import type { DomainEvent } from "@rcw/shared";
import type { EventStore } from "../../domain/events/event-store.port";

export class InMemoryEventStore implements EventStore {
  private events: DomainEvent[] = [];
  async append(event: DomainEvent) { this.events.push(event); }
  async list(limit = 100) { return this.events.slice(-limit).reverse(); }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @rcw/api test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): hexagonal EventStore port + RecordEvent use case"
```

---

### Task 5: Postgres adapter + SQL migration runner

**Files:**
- Create: `apps/api/migrations/001_domain_events.sql`
- Create: `apps/api/src/infrastructure/db.ts`, `apps/api/src/infrastructure/migrate.ts`
- Create: `apps/api/src/adapters/persistence/postgres-event-store.ts`

*(No Mac-side test — Postgres lives on the dev server; verified by Task 10 smoke. The adapter mirrors the in-memory contract already tested in Task 4.)*

- [ ] **Step 1: Migration SQL** — `apps/api/migrations/001_domain_events.sql`

```sql
CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_domain_events_occurred_at ON domain_events (occurred_at DESC);
```

- [ ] **Step 2: Pool + migration runner**

`apps/api/src/infrastructure/db.ts`:
```ts
import { Pool } from "pg";

export const createPool = (databaseUrl: string) => new Pool({ connectionString: databaseUrl });
```

`apps/api/src/infrastructure/migrate.ts` (idempotent, tracks applied files — PRD 006 FR-12):
```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "./db";

export async function migrate(databaseUrl: string, dir = join(__dirname, "../../migrations")) {
  const pool = createPool(databaseUrl);
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const applied = new Set((await pool.query("SELECT name FROM _migrations")).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    await pool.query("BEGIN");
    try {
      await pool.query(readFileSync(join(dir, file), "utf8"));
      await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  }
  await pool.end();
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  migrate(url).then(() => process.exit(0));
}
```

- [ ] **Step 3: Postgres adapter** — `apps/api/src/adapters/persistence/postgres-event-store.ts`

```ts
import type { Pool } from "pg";
import { DomainEventSchema, type DomainEvent } from "@rcw/shared";
import type { EventStore } from "../../domain/events/event-store.port";

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async append(e: DomainEvent): Promise<void> {
    await this.pool.query(
      "INSERT INTO domain_events (id, type, source, occurred_at, payload) VALUES ($1,$2,$3,$4,$5)",
      [e.id, e.type, e.source, e.occurredAt, JSON.stringify(e.payload)]
    );
  }

  async list(limit = 100): Promise<DomainEvent[]> {
    const { rows } = await this.pool.query(
      "SELECT id, type, source, occurred_at AS \"occurredAt\", payload FROM domain_events ORDER BY occurred_at DESC LIMIT $1",
      [limit]
    );
    return rows.map((r) => DomainEventSchema.parse(r));
  }
}
```

- [ ] **Step 4: Build check + commit**

Run: `pnpm --filter @rcw/shared build && pnpm --filter @rcw/api build`
Expected: clean compile.

```bash
git add -A && git commit -m "feat(api): postgres event store + sql migration runner"
```

---

### Task 6: Events HTTP endpoints + instance-token guard (TDD)

**Files:**
- Create: `apps/api/src/adapters/http/events.controller.ts`, `apps/api/src/adapters/http/instance-token.guard.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/events.e2e.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/api/test/events.e2e.test.ts`

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("/events", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("rejects without token", async () => {
    await request(app.getHttpServer()).post("/events").send({ type: "a.b", source: "t" }).expect(401);
  });

  it("records and lists an event with token", async () => {
    const auth = { Authorization: "Bearer test-token" };
    const created = await request(app.getHttpServer())
      .post("/events").set(auth).send({ type: "smoke.test", source: "vitest", payload: { ok: true } })
      .expect(201);
    expect(created.body.id).toBeDefined();
    const list = await request(app.getHttpServer()).get("/events").set(auth).expect(200);
    expect(list.body.some((e: { id: string }) => e.id === created.body.id)).toBe(true);
  });

  it("400s invalid body", async () => {
    await request(app.getHttpServer())
      .post("/events").set({ Authorization: "Bearer test-token" }).send({ type: "" }).expect(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @rcw/api test events`
Expected: FAIL (404s — controller missing).

- [ ] **Step 3: Implement**

`apps/api/src/adapters/http/instance-token.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "../../infrastructure/config";

@Injectable()
export class InstanceTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const header = req.headers["authorization"] ?? "";
    if (header !== `Bearer ${loadConfig().INSTANCE_TOKEN}`) throw new UnauthorizedException();
    return true;
  }
}
```

`apps/api/src/adapters/http/events.controller.ts`:
```ts
import { BadRequestException, Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { RecordEventUseCase } from "../../application/record-event.use-case";
import { EVENT_STORE, type EventStore } from "../../domain/events/event-store.port";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("events")
@UseGuards(InstanceTokenGuard)
export class EventsController {
  constructor(
    private readonly recordEvent: RecordEventUseCase,
    @Inject(EVENT_STORE) private readonly store: EventStore
  ) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.recordEvent.execute(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get()
  list() {
    return this.store.list();
  }
}
```

`apps/api/src/app.module.ts` (wires Postgres when `DATABASE_URL` set, in-memory otherwise — tests need no DB):
```ts
import { Module } from "@nestjs/common";
import { HealthController } from "./adapters/http/health.controller";
import { EventsController } from "./adapters/http/events.controller";
import { RecordEventUseCase } from "./application/record-event.use-case";
import { EVENT_STORE } from "./domain/events/event-store.port";
import { InMemoryEventStore } from "./adapters/persistence/in-memory-event-store";
import { PostgresEventStore } from "./adapters/persistence/postgres-event-store";
import { createPool } from "./infrastructure/db";
import { loadConfig } from "./infrastructure/config";

@Module({
  controllers: [HealthController, EventsController],
  providers: [
    RecordEventUseCase,
    {
      provide: EVENT_STORE,
      useFactory: () => {
        const { DATABASE_URL } = loadConfig();
        return DATABASE_URL ? new PostgresEventStore(createPool(DATABASE_URL)) : new InMemoryEventStore();
      },
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @rcw/api test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): /events endpoints with instance-token guard"
```

---

### Task 7: Prompt loader — Nunjucks over `prompts/**/*.md` (TDD)

**Files:**
- Create: `prompts/system/hello.md`
- Create: `apps/api/src/infrastructure/prompts/prompt-loader.ts`
- Test: `apps/api/test/prompt-loader.test.ts`

- [ ] **Step 1: Example prompt** — `prompts/system/hello.md`

```markdown
You are {{ persona_name }}, a member of the Redstone Cowork virtual team.
Your boss (the CEO) is the user. Today is {{ today }}.
Greet the boss briefly.
```

- [ ] **Step 2: Write the failing test** — `apps/api/test/prompt-loader.test.ts`

```ts
import { join } from "node:path";
import { PromptLoader } from "../src/infrastructure/prompts/prompt-loader";

describe("PromptLoader", () => {
  const loader = new PromptLoader(join(__dirname, "../../../prompts"));

  it("renders a template with variables", () => {
    const out = loader.render("system/hello.md", { persona_name: "Linh", today: "2026-06-07" });
    expect(out).toContain("You are Linh");
    expect(out).toContain("2026-06-07");
  });

  it("throws on missing template", () => {
    expect(() => loader.render("nope/missing.md", {})).toThrow();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @rcw/api test prompt-loader`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — `apps/api/src/infrastructure/prompts/prompt-loader.ts`

```ts
import nunjucks from "nunjucks";

/** All system prompts live as .md Jinja templates under prompts/ — never in code (PLAN.md working agreement). */
export class PromptLoader {
  private readonly env: nunjucks.Environment;

  constructor(promptsDir: string) {
    this.env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(promptsDir, { noCache: false }),
      { autoescape: false, throwOnUndefined: true }
    );
  }

  render(relativePath: string, vars: Record<string, unknown>): string {
    return this.env.render(relativePath, vars);
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @rcw/api test`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): nunjucks prompt loader over prompts/*.md"
```

---

### Task 8: `apps/worker` — heartbeat via API

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/main.ts`

Worker proves the full chain: worker → API (token auth) → Postgres. Interval via `HEARTBEAT_INTERVAL_MS` (default 60000).

- [ ] **Step 1: Package files**

`apps/worker/package.json`:
```json
{
  "name": "@rcw/worker",
  "version": "0.0.1",
  "scripts": { "build": "tsc -p tsconfig.json", "start": "node dist/main.js", "test": "echo no tests yet" },
  "dependencies": { "@rcw/shared": "workspace:*" },
  "devDependencies": { "@types/node": "^22.0.0" }
}
```

`apps/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "module": "CommonJS", "moduleResolution": "Node" },
  "include": ["src"]
}
```

- [ ] **Step 2: Implement** — `apps/worker/src/main.ts`

```ts
import type { NewDomainEvent } from "@rcw/shared";

const API_URL = process.env.API_URL ?? "http://api:3001";
const TOKEN = process.env.INSTANCE_TOKEN ?? "dev-token";
const INTERVAL = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 60000);

async function beat() {
  const event: NewDomainEvent = {
    type: "worker.heartbeat",
    source: "worker",
    payload: { hostname: process.env.HOSTNAME ?? "unknown" },
  };
  try {
    const res = await fetch(`${API_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(event),
    });
    console.log(`[worker] heartbeat -> ${res.status}`);
  } catch (e) {
    console.error("[worker] heartbeat failed:", (e as Error).message);
  }
}

console.log(`[worker] starting, beating every ${INTERVAL}ms`);
beat();
setInterval(beat, INTERVAL);
```

- [ ] **Step 3: Build check + commit**

Run: `pnpm install && pnpm --filter @rcw/worker build`
Expected: clean compile.

```bash
git add -A && git commit -m "feat(worker): heartbeat events via api"
```

---

### Task 9: `apps/web` — minimal Next.js status page

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`

Server-side fetch only (token never reaches the browser). Liquid-glass design starts in M5 — this page is deliberately plain.

- [ ] **Step 1: Package files**

`apps/web/package.json`:
```json
{
  "name": "@rcw/web",
  "version": "0.0.1",
  "scripts": { "build": "next build", "start": "next start -p 3000", "dev": "next dev -p 3000", "test": "echo no tests yet" },
  "dependencies": { "next": "^15.3.0", "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "@types/react": "^19.0.0", "@types/node": "^22.0.0" }
}
```

`apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "es2022"], "jsx": "preserve", "module": "esnext",
    "moduleResolution": "bundler", "strict": true, "skipLibCheck": true, "esModuleInterop": true,
    "incremental": true, "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone" };
export default nextConfig;
```

- [ ] **Step 2: Pages**

`apps/web/app/layout.tsx`:
```tsx
export const metadata = { title: "Redstone Cowork" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui", background: "#0a0e1a", color: "#e8ecf4", margin: 0, padding: "4rem" }}>{children}</body></html>
  );
}
```

`apps/web/app/page.tsx`:
```tsx
const API_URL = process.env.API_INTERNAL_URL ?? "http://api:3001";
const TOKEN = process.env.INSTANCE_TOKEN ?? "dev-token";

export const dynamic = "force-dynamic";

async function getStatus() {
  try {
    const health = await fetch(`${API_URL}/health`, { cache: "no-store" }).then((r) => r.json());
    const events = await fetch(`${API_URL}/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store",
    }).then((r) => (r.ok ? r.json() : []));
    return { health, eventCount: events.length, latest: events[0] ?? null };
  } catch {
    return { health: { status: "unreachable" }, eventCount: 0, latest: null };
  }
}

export default async function Home() {
  const s = await getStatus();
  return (
    <main>
      <h1>Redstone Cowork</h1>
      <p>API: <strong>{s.health.status}</strong></p>
      <p>Domain events recorded: <strong>{s.eventCount}</strong></p>
      {s.latest && <pre style={{ background: "#131a2e", padding: "1rem", borderRadius: 8 }}>{JSON.stringify(s.latest, null, 2)}</pre>}
    </main>
  );
}
```

- [ ] **Step 3: Build check + commit**

Run: `pnpm install && pnpm --filter @rcw/web build`
Expected: Next build succeeds.

```bash
git add -A && git commit -m "feat(web): minimal status page"
```

---

### Task 10: Dockerfiles + docker-compose.yml

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `docker-compose.yml`, `.dockerignore`

- [ ] **Step 1: `.dockerignore`**

```
node_modules
**/node_modules
**/dist
**/.next
.git
.creds
.env
docs
```

- [ ] **Step 2: API Dockerfile** — `apps/api/Dockerfile` (context = repo root)

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @rcw/api... 
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @rcw/shared build && pnpm --filter @rcw/api build
RUN pnpm --filter @rcw/api deploy --prod /out

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/apps/api/dist dist
COPY --from=build /repo/apps/api/migrations migrations
COPY prompts /prompts
ENV PROMPTS_DIR=/prompts
CMD ["sh", "-c", "node dist/infrastructure/migrate.js && node dist/main.js"]
```

- [ ] **Step 3: Worker Dockerfile** — `apps/worker/Dockerfile`

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @rcw/worker...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN pnpm --filter @rcw/shared build && pnpm --filter @rcw/worker build
RUN pnpm --filter @rcw/worker deploy --prod /out

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/apps/worker/dist dist
CMD ["node", "dist/main.js"]
```

- [ ] **Step 4: Web Dockerfile** — `apps/web/Dockerfile`

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @rcw/web...
COPY apps/web apps/web
RUN pnpm --filter @rcw/web build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone .
COPY --from=build /repo/apps/web/.next/static apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 5: `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: rcw
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: rcw
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rcw"]
      interval: 5s
      timeout: 3s
      retries: 10

  qdrant:
    image: qdrant/qdrant:v1.13.4
    volumes:
      - qdrantdata:/qdrant/storage
    healthcheck:
      test: ["CMD-SHELL", "bash -c ':> /dev/tcp/127.0.0.1/6333' || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 10

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    environment:
      PORT: 3001
      DATABASE_URL: postgres://rcw:${POSTGRES_PASSWORD}@postgres:5432/rcw
      INSTANCE_TOKEN: ${INSTANCE_TOKEN}
    ports:
      - "${API_PORT:-47101}:3001"
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 5s
      retries: 10

  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    environment:
      API_URL: http://api:3001
      INSTANCE_TOKEN: ${INSTANCE_TOKEN}
      HEARTBEAT_INTERVAL_MS: 60000
    depends_on:
      api: { condition: service_healthy }

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    environment:
      API_INTERNAL_URL: http://api:3001
      INSTANCE_TOKEN: ${INSTANCE_TOKEN}
    ports:
      - "${WEB_PORT:-47100}:3000"
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/ > /dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
  qdrantdata:
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(deploy): dockerfiles + parameterized docker-compose"
```

---

### Task 11: `deploy/remote.sh` — sync & drive the dev server

**Files:**
- Create: `deploy/remote.sh` (chmod +x)

- [ ] **Step 1: Implement**

```bash
#!/usr/bin/env bash
# Drive Redstone Cowork on a remote Docker host (the Mac never runs Docker).
# Usage: deploy/remote.sh {sync|init|up|down|logs|ps|smoke} [args...]
set -euo pipefail

SERVER="${DEV_SERVER:-ubuntu@18.143.147.28}"
DIR="${DEV_DIR:-/home/ubuntu/redstone-cowork}"

sync() {
  rsync -az --delete \
    --exclude .git --exclude node_modules --exclude '*/node_modules' \
    --exclude .creds --exclude .env --exclude dist --exclude .next \
    ./ "$SERVER:$DIR/"
}

case "${1:-help}" in
  sync) sync ;;
  init) # first-time: create .env from example with generated secrets
    sync
    ssh "$SERVER" "cd $DIR && [ -f .env ] || (cp .env.example .env \
      && sed -i \"s/change-me-postgres/\$(openssl rand -hex 16)/\" .env \
      && sed -i \"s/change-me-token/\$(openssl rand -hex 24)/\" .env \
      && echo '.env created')" ;;
  up)    sync; ssh "$SERVER" "cd $DIR && docker compose up -d --build" ;;
  down)  ssh "$SERVER" "cd $DIR && docker compose down" ;;
  logs)  ssh "$SERVER" "cd $DIR && docker compose logs ${2:---tail=100}" ;;
  ps)    ssh "$SERVER" "cd $DIR && docker compose ps" ;;
  smoke) # end-to-end M0 exit criteria check, runs entirely on the server
    ssh "$SERVER" "cd $DIR && set -e
      . ./.env
      echo '--- health ---'
      curl -sf http://localhost:\${API_PORT:-47101}/health
      echo; echo '--- record event ---'
      curl -sf -X POST http://localhost:\${API_PORT:-47101}/events \
        -H \"Authorization: Bearer \$INSTANCE_TOKEN\" -H 'Content-Type: application/json' \
        -d '{\"type\":\"smoke.test\",\"source\":\"remote.sh\",\"payload\":{\"m\":\"M0\"}}'
      echo; echo '--- list events ---'
      curl -sf http://localhost:\${API_PORT:-47101}/events -H \"Authorization: Bearer \$INSTANCE_TOKEN\" | head -c 400
      echo; echo '--- web ---'
      curl -sf http://localhost:\${WEB_PORT:-47100}/ -o /dev/null -w 'web: %{http_code}\n'
      echo '--- compose ps ---'
      docker compose ps" ;;
  *) echo "usage: deploy/remote.sh {sync|init|up|down|logs|ps|smoke}"; exit 1 ;;
esac
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x deploy/remote.sh
git add -A && git commit -m "feat(deploy): remote.sh to sync and drive dev server"
```

---

### Task 12: Deploy to dev server + M0 exit verification

- [ ] **Step 1: First-time init**

Run: `deploy/remote.sh init`
Expected: rsync completes, `.env created`.

- [ ] **Step 2: Bring the stack up**

Run: `deploy/remote.sh up`
Expected: 5 services build and start (first build takes minutes).

- [ ] **Step 3: Smoke test (M0 exit criteria)**

Run: `deploy/remote.sh smoke`
Expected output:
- `/health` → `{"status":"ok","service":"api"}`
- POST `/events` → JSON with generated `id`
- GET `/events` → list containing `smoke.test` (and `worker.heartbeat` after 60s)
- `web: 200`
- `docker compose ps` → postgres/qdrant/api/web **healthy**, worker running

- [ ] **Step 4: Verify custom ports work (PRD 006 FR-1)**

On server: edit `.env` → `WEB_PORT=47200`, `API_PORT=47201`, `docker compose up -d`, re-run smoke.
Expected: same results on new ports. Revert to 47100/47101 after.

- [ ] **Step 5: Full local test suite green**

Run: `pnpm test` (Mac)
Expected: shared + api suites pass.

- [ ] **Step 6: Push + report**

```bash
git push origin main
```
Then: comment + transition RCW-2 in Jira (In Progress → Done with summary), post progress update to Mattermost `redstone-cowork` channel.

---

## Self-Review Notes

- **Spec coverage:** PLAN.md M0 items — monorepo ✓ (T1), compose with 5 services ✓ (T10), hexagonal NestJS skeleton ✓ (T3/T4/T6), shared Zod ✓ (T2), Jinja prompt loading ✓ (T7), single-user auth ✓ (T6 guard), env-parameterized ports/volumes ✓ (T10/T12), exit criteria ✓ (T12 smoke). PRD 006 FR-1..FR-4 covered; FR-5+ are M6.
- **Qdrant** is provisioned but unused by code in M0 (first consumer is PRD 002 embeddings) — intentional, keeps compose contract stable.
- **Version pins are best-effort** — executor should accept newer compatible minors if installs fail.
