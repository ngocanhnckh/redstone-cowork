# M2 Slice 1 — Connector Framework + Jira & Mattermost

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans.

**Goal:** A reusable connector framework with an encrypted credential vault and scheduler, plus Jira (PAT, Data Center v2) and Mattermost (PAT) connectors that ingest the user's signals into a unified, idempotent event stream — connectable and monitorable from the web.

**Architecture:** Hexagonal. `ConnectorPort` adapters (Jira, Mattermost) live in the API and normalize platform data into a unified envelope. Connections + encrypted creds + ingested events persist in Postgres (in-memory in tests). The API exposes connection CRUD + validate + a `sync-due` use case; the worker is a thin cron that calls `sync-due` on an interval. Idempotent ingestion via a unique `(source, source_id, type)` key.

**Tech Stack:** NestJS, Node crypto (AES-256-GCM), Zod shared envelope, Postgres migration, Next.js connect UI.

---

## Task 1 — shared: envelope + connector types
**Files:** Create `packages/shared/src/integrations/integrations.ts`; modify barrel.
- `ConnectorKindSchema` = enum(`jira`,`mattermost`).
- `IngestedEventSchema` = `{ source, sourceId, type, occurredAt: coerce.date, actor: string.nullable, payload: record, links: array(record).default([]) }` (FR-2).
- `ConnectionSchema` (public, no secrets) = `{ id, kind, endpoint, label, status: enum(connected|erroring|disabled), lastSyncAt: date|null, lastError: string|null, config: record }`.
- `NewConnectionSchema` = `{ kind, endpoint, token, label?, config? }` (token only inbound).

## Task 2 — migration 006
**Files:** Create `apps/api/migrations/006_connections.sql`.
- `connections(id uuid pk, kind text, endpoint text, label text, config jsonb default '{}', secret_cipher text not null, cursor jsonb default '{}', status text default 'connected', last_sync_at timestamptz, last_error text, created_at timestamptz default now())`.
- `ingested_events(id uuid pk, source text, source_id text, type text, occurred_at timestamptz, actor text, payload jsonb default '{}', links jsonb default '[]', ingested_at timestamptz default now(), unique(source, source_id, type))`.

## Task 3 — credential vault
**Files:** Create `apps/api/src/infrastructure/credential-cipher.ts`. Test.
- AES-256-GCM with key from `CRED_ENCRYPTION_KEY` (base64, 32 bytes). `encrypt(plain)->"iv.tag.ct"` (base64 parts); `decrypt(blob)->plain`. `isConfigured()`. Throws clearly if used unconfigured.

## Task 4 — domain ports
**Files:** `apps/api/src/domain/integrations/{connector.port.ts,connection-store.port.ts,ingested-event-store.port.ts}`.
- `ConnectorPort`: `validate(cfg): Promise<{ok, error?}>`, `pull(cfg, cursor): Promise<{events: IngestedEvent[], cursor}>`, `kind`. (writeBack later.)
- `ConnectionStore`: create/list/get/updateCursorStatus/delete.
- `IngestedEventStore`: `appendMany(events): Promise<number>` (idempotent, returns inserted count), `recent(limit)`.

## Task 5 — persistence adapters
**Files:** in-memory + pg for connection-store and ingested-event-store. Tests for in-memory (incl. idempotency: appending the same event twice inserts once).

## Task 6 — Jira connector
**Files:** `apps/api/src/adapters/connectors/jira.connector.ts`. Test (mock fetch).
- `validate`: GET `/rest/api/2/myself` with `Authorization: Bearer <pat>`.
- `pull`: JQL search updated since cursor (`/rest/api/2/search`), issues assigned/reported/watched + comments; normalize to events (`type: jira.issue.updated|jira.comment`); cursor = max updated timestamp.

## Task 7 — Mattermost connector
**Files:** `apps/api/src/adapters/connectors/mattermost.connector.ts`. Test (mock fetch).
- `validate`: GET `/api/v4/users/me` Bearer.
- `pull`: mentions + DMs since cursor; normalize (`type: mattermost.mention|mattermost.dm`); cursor = last post create_at.

## Task 8 — application: connections + sync
**Files:** `apps/api/src/application/connections.service.ts`, `sync.service.ts`. Tests.
- ConnectionsService: `create` (validate via connector, encrypt token, store), `list` (public view), `disconnect` (hard delete). 
- SyncService: `syncOne(id)` (decrypt → connector.pull(cursor) → appendMany → advance cursor / set status+error) and `syncDue()` (all connected). Connector registry keyed by kind.

## Task 9 — http + module
**Files:** `apps/api/src/adapters/http/connections.controller.ts`; wire `app.module.ts`; env passthrough.
- `GET /connections`, `POST /connections`, `DELETE /connections/:id`, `POST /connections/sync-due`, `GET /events/recent`. Guarded.
- Providers/factories for stores, cipher, connectors, services. `CRED_ENCRYPTION_KEY` in `.env.example` + compose.

## Task 10 — worker scheduler
**Files:** modify `apps/worker` to call `POST /connections/sync-due` every N seconds (env `SYNC_INTERVAL_MS`, default 60000), backoff on error.

## Task 11 — web connect/status UI
**Files:** `apps/web/components/Connections.tsx`; page section; proxy allowlist.
- List connections w/ status + last sync; add (kind, endpoint, token) form; disconnect; manual re-sync; recent events feed.

## Task 12 — deploy + live test
- Generate `CRED_ENCRYPTION_KEY`, set on server. Migrate, deploy. Connect the real Jira + Mattermost (creds in .creds); confirm events flow; disconnect erases creds.
