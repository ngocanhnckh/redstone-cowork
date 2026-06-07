# PRD 005 — Situation Room

| | |
|---|---|
| Status | Approved |
| Milestone | M5 |
| Depends on | PRDs 001–004 (it surfaces all of them) |
| Master PRD | [000](./000-master-prd.md) |

## 1. Problem

The CEO needs one place to see the whole company at a glance — every running project, every live agent session, every decision waiting on them — and to act in seconds, especially from a phone. Without it, the user is back to checking N tabs.

## 2. Goal

A command-center view (web + mobile) that monitors all projects and activity in real time and **fast-tracks decisions**: each pending item shown with summary, the team's suggestion, and quick/custom response — actionable end-to-end from the phone.

## 3. User Stories

1. As a user, I open one screen and see: pending decisions (most urgent first), live Claude Code sessions, project statuses, and a recent-activity feed.
2. As a user, each pending decision shows a summary, the virtual team's suggestion, and response options — I can resolve it right there with one tap or a typed/spoken custom reply.
3. As a user, I see real-time updates without refreshing (a session finishing, a new decision, a task completing).
4. As a user, on my phone I triage every waiting decision in under a minute.
5. As a user, I can drill from any card into the full context (project chat, session log, task).

## 4. Functional Requirements

### Layout & content
- **FR-1** Four zones: **Decision queue** (pending decisions, sorted urgency-first), **Live sessions** (Claude Code session cards with status), **Projects board** (per-project health: active tasks, last activity, blocked count), **Activity feed** (unified event stream, filtered to significant items).
- **FR-2** Decision cards: title, 1–2 line summary, source (session/project), age, team suggestion (from PRD 004, e.g. "PM & Eng recommend B"), option buttons + custom reply field.
- **FR-3** Resolving from a card uses the same single-resolution path as notifications and chat (PRD 001 FR-9 / PRD 004 FR-9) — answer once anywhere, closed everywhere.
- **FR-4** Drill-down: decision → its project chat thread; session → session detail (event history); project → project view (backlog + chat).

### Real-time
- **FR-5** WebSocket-driven live updates on web; mobile uses push + on-open refresh (WS while foregrounded).
- **FR-6** Latency budget: state change → visible in Situation Room ≤ 2s (web, foreground).

### Mobile
- **FR-7** Mobile layout is decision-queue-first (the triage use case); other zones behind tabs.
- **FR-8** Every decision fully resolvable from mobile, including custom text reply.

### Design
- **FR-9** Liquid-glass design language (master PRD §7) with motion.dev transitions; this screen is the product's visual flagship. Density and glanceability take priority over decoration: status must be readable in one sweep.
- **FR-10** Empty/zero states are first-class ("all clear, boss" when no decisions pending).

## 5. Technical Notes

- Pure presentation layer over existing domain: decisions (PRD 001), sessions (PRD 001), projects/tasks (PRD 003), team suggestions (PRD 004). No new domain models — if something can't be shown, the gap is in an upstream PRD.
- Web: Next.js + WS gateway from `apps/api`; shared card components.
- Mobile: React Native screens reusing the same Zod view-models from `packages/shared`.
- Urgency sort for decisions: blocked-session decisions first (they hold up an agent), then by age × project priority.

## 6. Acceptance Criteria

1. With 3 projects, 2 live sessions, and 4 pending decisions seeded, everything is visible on one web screen and correctly grouped.
2. A new decision appears in the queue within 2s without refresh; resolving it removes it everywhere within 2s.
3. Full phone triage: from push notification → Situation Room → resolve 4 decisions (2 quick, 1 custom text, 1 after drilling into chat) — no desktop involved.
4. Session going `lost` visibly flags its card and any dependent decisions.
5. Lighthouse-measurable jank-free animations (60fps target on mid-range hardware) — motion never blocks interaction.
