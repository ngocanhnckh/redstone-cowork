# Redstone Cowork — Project Plan

> Companion docs: [ABOUT.md](./ABOUT.md) (vision) · [prd/000-master-prd.md](./prd/000-master-prd.md) (master PRD) · feature PRDs in [prd/](./prd/)

## 1. Context

Redstone Cowork turns every user into the "CEO" of their own simulated company. A virtual team of AI employees ingests the user's work streams (Jira, Mattermost, Gmail, Calendar, Claude Code sessions), keeps a clarified, prioritized backlog, surfaces decisions that need the boss's call, and relays answers back to running Claude Code sessions — from any device, anywhere.

**Deployment model:** self-hosted, single user per instance, simple Docker Compose. Companies may bulk-deploy many isolated instances on one shared server (one per employee). All Claude calls use the user's own Claude subscription via the Claude Agent SDK with their mounted credentials — traffic stays between the user and Anthropic.

**MVP platforms:** Next.js web app + React Native mobile app. Electron desktop and Apple Watch are post-MVP (web covers desktop usage in the interim).

## 2. MVP Scope

| # | Feature | PRD |
|---|---------|-----|
| 1 | Claude Code hook & notifications (decision relay, answer-from-anywhere) | [001](./prd/001-claude-code-hook.md) |
| 2 | Integration framework + connectors — Phase 1: Jira, Mattermost, Gmail, Google Calendar · Phase 2: GitHub, Outlook | [002](./prd/002-integrations.md) |
| 3 | Task sync & breakdown (unified backlog, 2-way Jira sync, LLM breakdown) | [003](./prd/003-task-sync-breakdown.md) |
| 4 | Virtual team (full: personas, project group chats, opinions on decisions) | [004](./prd/004-virtual-team.md) |
| 5 | Situation Room (monitoring + fast-track decisions, web + mobile) | [005](./prd/005-situation-room.md) |
| 6 | Deployment (single-instance Docker + bulk multi-employee mode) | [006](./prd/006-deployment.md) |

**Post-MVP:** proactive calendar planning (3h pre-meeting prep, 9 PM next-day planning, 5 AM brief), Google Drive context, mother-company gateway, Slack/Zalo connectors, Electron desktop, Apple Watch, re-runnable learning sessions beyond v1.

## 3. Architecture Summary

- **Monorepo** (pnpm + Turborepo):
  - `apps/api` — NestJS, hexagonal architecture (domain core; ports for connectors, notifications, agents; adapters per platform)
  - `apps/web` — Next.js (Situation Room, backlog, project chats; liquid-glass design with motion.dev)
  - `apps/mobile` — React Native (push notifications, quick replies, Situation Room)
  - `apps/hook-cli` — installable command that attaches any Claude Code session (any machine) to the server
  - `apps/worker` — LangGraph agents, pollers, schedulers
  - `packages/shared` — Zod schemas + domain types shared by API/web/mobile
  - `prompts/` — all system prompts as `.md` Jinja templates (never inline in code)
  - `deploy/` — Docker Compose, bulk-deploy tooling
- **Data:** Postgres (system of record), Qdrant (vectors), mem0 (agent memory)
- **Agents:** LangChain/LangGraph/DeepAgents for conversational + orchestration; Claude Agent SDK for complex CLI-class tasks (research, files, coding) with progress hooks back to the conversational layer
- **Event-based core:** connectors poll/webhook → unified event stream → mapping agents (entity/project/task) → notification & decision fan-out (WebSocket to web, push to mobile)

## 4. Milestones

### M0 — Foundation
Monorepo scaffold; Docker Compose (Postgres, Qdrant, API, web, worker); NestJS hexagonal skeleton; shared Zod package; prompt loading (Jinja over `.md`); single-user auth (instance password/token); env-parameterized ports/volumes (groundwork for bulk deploy).
**Exit:** `docker compose up` serves web + API on configurable ports; healthchecks green; one round-trip domain event persisted.

### M1 — Claude Code Hook & Notifications *(killer feature — works standalone, no integrations needed)*
Hook CLI + one-command session attach; session registry; decision capture (Claude finished / needs input / asks permission); multiple-choice + custom reply; WebSocket to web, push to mobile; answer routed back to the originating session on any machine.
**Exit:** user attaches a session on a remote server, gets a phone notification, taps an option, Claude continues — without touching that server.

### M2 — Integration Framework + Connectors v1
Connector port/adapter framework; encrypted credential vault; Jira (PAT, self-hosted Data Center supported), Mattermost (PAT), Gmail, Google Calendar; learning session v1 (pull last 1 month → map projects/entities → user profile).
**Exit:** all four connectors ingest into the unified event stream; learning session produces a reviewable project/entity map.

### M3 — Task Sync & Breakdown
Unified backlog; importance × urgency sorting; grouping by project/entity; 2-way Jira status sync; LLM breakdown into actionable steps (at minimum, clear first steps when uncertain).
**Exit:** a Jira ticket appears in the backlog broken into steps; completing it in Redstone updates Jira.

### M4 — Virtual Team (full)
Persona engine (personalities as prompt templates); auto-created project group chats; role casting per project (PM, Eng, UX, …); opinions on pending Claude Code decisions (PM: timeline/risk, Eng: technical, UX: experience); user's final call confirmed by PM → relayed to the Claude Code session; mem0-backed persona memory.
**Exit:** a real pending decision from M1 triggers a group-chat discussion; the user replies in chat; the answer reaches the session.

### M5 — Situation Room
Web + mobile dashboard: running projects, live activity, status updates, pending decisions with summaries + suggested responses; quick response and custom reply per decision.
**Exit:** every pending decision and active project visible and actionable from one screen on the phone.

### M6 — MVP Phase 2
GitHub + Outlook connectors; bulk deployment hardening (`deploy.sh`, employee manifest, reverse-proxy mode, shared-infra option); upgrade/backup story; polish pass on design (liquid glass, motion).
**Exit:** a company admin deploys 10 isolated instances on one server with one command; upgrades all with one command.

### Dependency graph
```
M0 ─→ M1 ─→ M4 ─→ M5
  └─→ M2 ─→ M3 ─┘     M6 builds on M2 (connectors) + M0 (deploy)
```
M1 and M2 can proceed in parallel after M0.

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Claude Code hook fragility across versions/machines | Thin, versioned hook protocol; CLI self-checks; session heartbeats; graceful "session lost" UX |
| Six connectors balloon scope | Hard phase split; one shared connector interface; Phase-2 connectors are adapters only, no framework changes |
| Virtual team feels gimmicky or noisy | Personas only speak when a decision/opinion is warranted; autonomy thresholds; user can mute roles |
| LLM cost/latency on user's subscription | Conversational tier on LangChain (cheap models OK); Claude Agent SDK reserved for complex tasks; batch/queue agent work |
| Bulk deploy resource bloat (N × Postgres/Qdrant) | Shared-infra option: one Postgres/Qdrant server, per-instance DB/collection |
| 2-way sync conflicts (Jira ↔ local) | Source-of-truth rules per field; idempotent sync ops; conflict surfaced as a decision, never silent overwrite |

## 6. Working Agreements

- Hexagonal architecture: domain core has zero framework/SDK imports; everything external behind a port.
- All system prompts live in `prompts/**/*.md`, rendered with Jinja — never hardcoded.
- Shared types defined once in `packages/shared` (Zod), consumed by API, web, mobile.
- Every milestone ends with a runnable end-to-end demo (its Exit criterion).
