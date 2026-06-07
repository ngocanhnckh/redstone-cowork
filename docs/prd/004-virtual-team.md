# PRD 004 — Virtual Team

| | |
|---|---|
| Status | Approved |
| Milestone | M4 |
| Depends on | PRD 001 (decisions), PRD 002/003 (projects, tasks) |
| Master PRD | [000](./000-master-prd.md) |

## 1. Problem

Raw notifications give the CEO information, not counsel. Real executives decide fast because their team frames the decision: the PM weighs timeline and risk, the engineer weighs feasibility, design weighs the user. Redstone Cowork simulates exactly that — turning every pending decision into a short, opinionated team discussion the user can act on in seconds.

This is the product's emotional core: the user runs a company, not a dashboard.

## 2. Goal

Every project gets a cast of fictional employees with distinct personalities and roles, a group chat, and the judgment to speak when useful and stay silent otherwise. When a decision is pending (e.g., a Claude Code session asks "approach A or B for feature X?"), relevant team members give short role-grounded opinions, the CEO replies in chat, the PM confirms the call, and the answer is relayed to the source automatically.

## 3. User Stories

1. As a user, when a project is created, a team is cast for it (PM always; Eng/UX/others based on project type) — each with a name, personality, and avatar.
2. As a user, each project has a group chat where the team posts status, discusses decisions, and answers me.
3. As a user, when Claude Code blocks on a question, my team discusses it: PM gives a timeline/risk view, Engineer the technical view, UX the experience view — each in 2–4 sentences.
4. As a user, I reply in the chat with my call (option pick or free text); the PM confirms it and the answer reaches the Claude Code session without me touching the server.
5. As a user, team members remember past context ("we hit this same trade-off in March") via persistent memory.
6. As a user, I can mute a role, recast a member, or tune how chatty the team is.

## 4. Functional Requirements

### Personas
- **FR-1** Persona = name, role, personality profile, speaking style, avatar. Defined entirely as `.md` Jinja prompt templates in `prompts/personas/` — zero personality in code.
- **FR-2** Default roster templates per project type (software, ops, personal); PM is always cast. User can add/remove/recast members per project.
- **FR-3** Persona memory via mem0, scoped per persona per project: past decisions, user preferences, project history. Memories surface naturally in opinions.

### Group chats
- **FR-4** One chat per project, auto-created with the project. Standard chat UX (web + mobile): threads on decisions, mentions, typing indicators for "thinking" personas.
- **FR-5** The CEO can ask the team anything in chat ("status?", "what's blocking?"); the appropriate member answers from live project data (tasks, sessions, events).
- **FR-6** Speak-when-useful policy: personas post on (a) new pending decision, (b) direct mention, (c) significant project events (configurable threshold). No filler chatter. Per-project chattiness setting (quiet / normal / lively).

### Decision discussions
- **FR-7** When a Decision (PRD 001) belongs to a project, relevant personas each post one opinion: role-grounded, ≤4 sentences, with an explicit recommendation. PM additionally frames the options and stakes.
- **FR-8** Opinions are generated from real context: decision payload, project task state, recent events, persona memory. Personas may disagree with each other — uniformity is a bug.
- **FR-9** The CEO's reply in-thread (tap an option or free text) is the final call. The PM posts a confirmation ("Going with B — relaying to the session"), and the decision resolves through the PRD 001 relay path. Notification quick-replies and chat replies are the same resolution — answering in either place closes both.
- **FR-10** If the CEO asks a follow-up question instead of deciding, the relevant persona answers; the decision stays pending (and the Claude session stays waiting) until an actual call is made.

### Autonomy (bounded, MVP)
- **FR-11** Personas act autonomously only for non-binding actions: summarizing, status posts, flagging risks. Anything that writes externally (answer a session, transition Jira) always requires the CEO's call in MVP.

## 5. Technical Notes

- Orchestration via LangGraph in `apps/worker`: decision event → cast selection → parallel opinion generation → chat posts. Opinions generated concurrently; ordering staggered for natural feel.
- Conversational tier (LangChain) for opinions; persona prompt = base persona `.md` + role lens `.md` + project context, rendered with Jinja.
- Chat persistence in Postgres; persona memory in mem0 (Qdrant-backed).
- Cost control: opinion generation batched per decision (one context assembly, N persona heads); chattiness thresholds gate generation, not just display.
- Hexagonal: `PersonaEnginePort` and `ChatPort` so the chat surface could later be Mattermost itself (post-MVP option).

## 6. Acceptance Criteria

1. Creating a project auto-creates its team and chat; roster matches project type.
2. A real pending Claude Code decision triggers PM + Engineer + UX opinions within 30s, each distinct, role-grounded, and recommendation-bearing.
3. Replying in chat resolves the decision and the answer reaches the remote session (full PRD 001 round-trip); PM confirmation message appears.
4. A persona references a relevant past decision from memory in at least one scripted test scenario.
5. Quiet mode: no posts except pending decisions and direct mentions.
6. Muting a role stops its posts without affecting decision relay.

## 7. Open Questions

- Voice replies from mobile (speak your call) — post-MVP, rides on existing resolution API.
- Persona disagreement escalation (structured debate rounds) — keep single-round in MVP, observe usage.
