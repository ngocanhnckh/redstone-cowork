# PRD 000 — Master PRD: Redstone Cowork

| | |
|---|---|
| Status | Approved |
| Last updated | 2026-06-07 |
| Feature PRDs | [001 Claude Code Hook](./001-claude-code-hook.md) · [002 Integrations](./002-integrations.md) · [003 Task Sync & Breakdown](./003-task-sync-breakdown.md) · [004 Virtual Team](./004-virtual-team.md) · [005 Situation Room](./005-situation-room.md) · [006 Deployment](./006-deployment.md) |

## 1. Vision

Every knowledge worker drowns in parallel data streams — Jira tickets, emails, chat messages, calendar events, and (for developers) multiple Claude Code sessions waiting on input. Redstone Cowork makes the user the **CEO of their own simulated company**: a virtual team of AI employees that ingests every stream, maintains one clarified and prioritized backlog, discusses decisions like a real team, and lets the boss make the final call from any device — which is then executed automatically (including answering remote Claude Code sessions).

The user's real employer is modeled as the **mother company**: Redstone Cowork is the user's personal company that serves it.

## 2. Problems Solved

1. **Context fragmentation** — tasks and signals scattered across Jira, Gmail/Outlook, Mattermost, calendars; no single prioritized view.
2. **Unclear work** — synced tasks are titles, not plans. Users stall on "where do I start?"
3. **Agent dead time** — Claude Code sessions finish or block on questions while the developer is away; multitasking devs lose hours to unnoticed prompts.
4. **Decision latency** — making a call requires logging into the machine where the agent runs.

## 3. Personas

- **Solo Dev "Anh"** — runs 2–5 Claude Code sessions across a laptop and two servers; lives in Jira + Mattermost at work; wants zero dead time and a phone-first decision flow.
- **Knowledge worker "Mai"** — no agents, but heavy email/calendar/Jira; wants one clear daily backlog and meeting prep.
- **Company admin "Quang"** — deploys instances for a team on a shared server; wants isolation per employee, simple bulk ops, and (post-MVP) the mother-company gateway for status reporting.

## 4. Product Concepts

| Concept | Meaning |
|---|---|
| **Company** | The user's simulated org. One per instance. |
| **CEO** | The user. Final decision-maker. |
| **Mother company** | The user's real employer (post-MVP gateway reports to it). |
| **Entity** | A real-world grouping discovered from streams (client, team, system). |
| **Project** | A unit of work grouping tasks, chats, and agent sessions; has a virtual team. |
| **Virtual employee** | An AI persona (PM, Eng, UX, …) with personality, memory, and a role on projects. |
| **Decision** | Anything awaiting the CEO: Claude Code question/permission, plan approval, conflict. Has summary, options, suggestion. |
| **Situation Room** | The command center UI showing all projects, activity, and pending decisions. |

## 5. MVP Definition

**In scope (MVP):**
1. Claude Code hook & notifications — attach any session anywhere; decisions answered from web/mobile (PRD 001)
2. Integrations — framework + Jira, Mattermost, Gmail, Google Calendar (Phase 1); GitHub, Outlook (Phase 2); learning session v1 (PRD 002)
3. Task sync & breakdown — unified backlog, Eisenhower sorting, 2-way Jira sync, LLM breakdown (PRD 003)
4. Virtual team (full) — personas, project group chats, opinions on decisions, PM-confirmed relay (PRD 004)
5. Situation Room — web + mobile (PRD 005)
6. Deployment — single-instance Docker + bulk multi-employee mode (PRD 006)

**Out of scope (post-MVP):** proactive calendar planning (pre-meeting prep, 9 PM planning, 5 AM brief), Google Drive context, mother-company gateway, Slack/Zalo, Electron desktop, Apple Watch.

**Platforms (MVP):** Next.js web, React Native mobile (iOS + Android).

## 6. Architecture Overview

Hexagonal architecture: a framework-free domain core; ports define what the system needs (connectors, notifier, agent runtime, persistence); adapters implement them per platform.

```
apps/
  api/        NestJS — domain core + ports/adapters, REST + WebSocket
  worker/     LangGraph agents, connector pollers, schedulers
  web/        Next.js — Situation Room, backlog, project chats
  mobile/     React Native — push, quick replies, Situation Room
  hook-cli/   attaches Claude Code sessions to the server
packages/
  shared/     Zod schemas + domain types (single source of truth)
prompts/      all system prompts as .md Jinja templates
deploy/       Docker Compose + bulk tooling
```

**Data flow (event-based core):**
```
connectors (poll/webhook) ──→ unified event stream ──→ mapping agents
                                                    (entity/project/task)
Claude Code hooks ─────────→ decisions ───→ virtual team discussion
                                        └─→ notifications (WS web / push mobile)
user reply (any device) ───→ decision resolution ───→ relay to source
                                                      (Claude session, Jira, …)
```

**Stack:** Postgres (system of record) · Qdrant (vectors) · mem0 (agent memory) · LangChain/LangGraph/DeepAgents (conversational + orchestration) · Claude Agent SDK (complex CLI-class tasks, with progress hooks back to conversational layer) · NestJS + Next.js + React Native with shared Zod.

**Claude usage model:** every instance uses the owner's Claude subscription via mounted credentials; all Claude traffic is strictly between the user and Anthropic.

## 7. Design Language

Futuristic, elegant, **liquid glass** with motion (reference: [Quantum Glide concept](https://dribbble.com/shots/26193823-Quantum-Glide-Futuristic-AI-Driven-Transport-UI-Concept)). motion.dev animations on web; adapted equivalents on mobile. Dark-first, glassmorphic surfaces, kinetic transitions — but information density and legibility win every conflict with decoration.

## 8. Success Metrics (MVP)

| Metric | Target |
|---|---|
| Claude decision response time (notification → answered) | median < 2 min when user has phone |
| Claude session dead time | reduced > 80% vs. unhooked baseline |
| Tasks entering backlog with actionable first steps | 100% (at minimum first 1–3 steps) |
| Jira 2-way sync correctness | no silent conflict overwrites; conflicts surfaced as decisions |
| Bulk deploy | 10 isolated instances on one server via one command |

## 9. Non-Goals

- Multi-tenant SaaS (one user per instance, by design)
- Replacing Jira/Mattermost — Redstone mirrors and clarifies; sources stay canonical for their own data
- Autonomous decisions on the CEO's behalf — the team advises, the user decides (autonomy thresholds may relax this per-user, post-MVP)
