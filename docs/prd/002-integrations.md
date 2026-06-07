# PRD 002 — Integration Framework & Connectors

| | |
|---|---|
| Status | Approved |
| Milestone | M2 (Phase 1) · M6 (Phase 2) |
| Depends on | M0 foundation |
| Master PRD | [000](./000-master-prd.md) |

## 1. Problem

The user's work lives in many systems. Redstone Cowork needs a uniform, extensible way to connect them, ingest their signals into one event stream, and (for some) write back. Connectors must be cheap to add — the framework is built once, every connector after is an adapter.

## 2. Scope

| Phase | Connectors |
|---|---|
| **Phase 1 (M2)** | Jira (PAT — Cloud *and* self-hosted Data Center), Mattermost (PAT), Gmail, Google Calendar |
| **Phase 2 (M6)** | GitHub, Outlook (mail + calendar) |
| Post-MVP | Slack, Zalo, Google Drive |

Also in scope (M2): **Learning Session v1** — initial 1-month ingestion that maps the user's projects/entities and builds their profile.

## 3. User Stories

1. As a user, I connect Jira by pasting my endpoint + PAT; the app validates and confirms within seconds. Same pattern for Mattermost. Gmail/Calendar connect via Google OAuth.
2. As a user, new Jira issues, Mattermost mentions/DMs, emails, and calendar events flow into Redstone and are grouped under the right project/entity automatically.
3. As a user, on first run I trigger a learning session: the agent pulls the last month from all connected sources, proposes a map of my projects and entities, and a profile of me — which I can review and correct. I can re-run this anytime.
4. As a user, I can disconnect a source at any time; its credentials are erased.

## 4. Functional Requirements

### Framework
- **FR-1** `ConnectorPort` interface every connector implements: `validateCredentials`, `pull(since)`, `subscribe` (webhook/poll), `writeBack(op)` (optional capability), `healthcheck`.
- **FR-2** Unified event envelope (Zod, in `packages/shared`): `{source, sourceId, type, occurredAt, actor, payload, links}` — every connector normalizes into it.
- **FR-3** Credential vault: encrypted at rest (per-instance key), never logged, never leaves the instance. Disconnect = hard delete.
- **FR-4** Scheduler: per-connector poll intervals with backoff on rate limits; webhook ingestion where the platform supports it; idempotent ingestion (re-pulls never duplicate events).
- **FR-5** Connector status UI: connected/erroring/rate-limited, last sync time, manual re-sync button.

### Connectors — Phase 1
- **FR-6 Jira:** PAT + endpoint URL; must support self-hosted Data Center (API v2) and Cloud. Ingest: issues assigned to/reported by/watched by user, status changes, comments, mentions. Write-back: status transitions, comments (used by PRD 003).
- **FR-7 Mattermost:** PAT + endpoint. Ingest: DMs, mentions, messages in user-selected channels. Write-back: post messages (used for virtual-team output if user opts in, and project updates).
- **FR-8 Gmail:** OAuth. Ingest: new mail in inbox (configurable labels/filters), thread context. Write-back: none in MVP (drafts post-MVP).
- **FR-9 Google Calendar:** OAuth. Ingest: events, changes, invites. Write-back: none in MVP (event creation is post-MVP proactive planning).

### Connectors — Phase 2 (M6)
- **FR-10 GitHub:** PAT/OAuth. Ingest: assigned issues/PRs, review requests, mentions, CI failures on own PRs.
- **FR-11 Outlook:** Microsoft OAuth (Graph). Mail + calendar, mirroring FR-8/FR-9.

### Learning Session
- **FR-12** Pull up to 1 month of history from every connected source.
- **FR-13** Mapping agent clusters the corpus into proposed **Entities** and **Projects** (Qdrant embeddings + LLM labeling), with evidence (which messages/issues led to each).
- **FR-14** User profile generated: role, working patterns, key collaborators, recurring meetings.
- **FR-15** Review screen: user merges/renames/deletes proposed projects/entities before confirming. Re-runnable anytime; re-runs propose diffs, never silently restructure.
- **FR-16** After learning, incoming events are classified into existing projects/entities, or trigger a "new project?" suggestion when nothing fits.

## 5. Technical Notes

- Hexagonal: connectors are adapters behind `ConnectorPort`; the domain core only sees the unified envelope.
- Workers (`apps/worker`) own polling and ingestion; API stays request-scoped.
- Embedding + clustering in Qdrant; classification prompts in `prompts/mapping/*.md`.
- Jira Data Center quirk: PAT auth header (`Authorization: Bearer`), older API versions — test against a real instance early (the team has one available for testing).

## 6. Acceptance Criteria

1. Connect all four Phase-1 sources on a fresh instance in < 5 minutes total.
2. A new Jira comment mentioning the user appears as a unified event within one poll interval.
3. Learning session on a real account produces a project/entity map the user confirms with ≤ minor edits, with evidence links.
4. Disconnecting a source removes its credentials (verified at DB level) and stops its polling.
5. Re-running a pull never duplicates events (idempotency).

## 7. Open Questions

- Webhook support depends on user's server being reachable from each platform — default to polling, allow webhooks as an optimization where reachable.
- Gmail OAuth app verification (Google review) for self-hosted distribution — document the "bring your own OAuth client" path.
