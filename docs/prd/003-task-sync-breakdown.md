# PRD 003 — Task Sync & Breakdown

| | |
|---|---|
| Status | Approved |
| Milestone | M3 |
| Depends on | PRD 002 (connectors), M0 |
| Master PRD | [000](./000-master-prd.md) |

## 1. Problem

Tasks arrive as raw titles scattered across systems. Users need **one backlog** that is (a) complete, (b) prioritized by what actually matters, and (c) clarified — every task broken into actionable steps so starting is never the hard part. Status changes must flow back to the source system so the user never maintains two trackers.

## 2. Goal

A unified personal backlog where every task is grouped by project/entity, sorted by importance × urgency, broken into actionable steps by an agent, and kept in 2-way sync with its source (Jira in MVP).

## 3. User Stories

1. As a user, every task-like signal (Jira issue, actionable email, Mattermost ask, meeting follow-up) lands in my backlog under the right project.
2. As a user, my backlog is sorted by importance and urgency — I work top-down without re-triaging.
3. As a user, every task shows actionable steps. If the agent is uncertain how to fully break it down, it gives me at least the first 1–3 concrete steps to get started.
4. As a user, when I complete a linked task in Redstone, the Jira issue transitions automatically (and vice versa).
5. As a user, I can add manual tasks, edit steps, and re-prioritize — my corrections teach the prioritizer.

## 4. Functional Requirements

### Unified backlog
- **FR-1** Task model (Zod, shared): title, description, source link (nullable for manual), project/entity, importance, urgency, status, steps[], due date, created-from-event reference.
- **FR-2** Task extraction agent: classifies unified events (PRD 002) as task / FYI / noise. Jira issues assigned to the user are always tasks; emails and chat messages are extracted only when they contain an actionable ask (with link back to the source message).
- **FR-3** Grouping: every task is assigned to a project/entity via the mapping from PRD 002; user can re-assign (which feeds back into mapping).
- **FR-4** Prioritization: importance × urgency (Eisenhower) scored by agent from due dates, source signals (who asked, escalations), and learned user profile. User overrides are sticky and feed the model.
- **FR-5** Views: by priority (default), by project, by source. Web + mobile.

### Breakdown
- **FR-6** On task creation, a breakdown agent produces actionable steps. Confidence-aware: full breakdown when clear; otherwise **at minimum the first 1–3 concrete starter steps** plus an explicit "then reassess" marker.
- **FR-7** Breakdown uses available context: the source thread/issue, project history, related docs in the event stream. Steps are editable; checking off steps tracks progress.
- **FR-8** When a task is too ambiguous even for starter steps, the agent asks the user clarifying questions via a Decision (PRD 001 model) rather than guessing.

### 2-way sync (Jira in MVP)
- **FR-9** Linked tasks mirror status: Redstone "done" → mapped Jira transition; Jira transition → Redstone status. Mapping of Redstone statuses ↔ Jira workflow states is configured per Jira project (sane defaults; editable).
- **FR-10** Sync is idempotent and loop-safe (a write-back must not re-ingest as a new change).
- **FR-11** Conflicts (both sides changed since last sync) are never silently resolved — they surface as a Decision with both states and one-tap resolution.
- **FR-12** Comments: completing a task can optionally post a configurable comment to Jira ("Done via Redstone Cowork — steps: …"). Off by default.

## 5. Technical Notes

- Extraction/breakdown/prioritization prompts in `prompts/tasks/*.md` (Jinja).
- Breakdown runs on the conversational tier (LangChain); long-context cases may escalate to Claude Agent SDK.
- Sync engine: per-link version vector (`lastSeenSourceVersion`, `lastWrittenAt`) to detect conflicts; all write-backs through `ConnectorPort.writeBack`.
- Priority scoring is explainable: each task stores *why* it scored as it did (shown on tap).

## 6. Acceptance Criteria

1. A Jira issue assigned to the user appears in the backlog, grouped under the right project, with ≥ first steps, within one poll interval.
2. An email containing a clear ask becomes a task linked to the thread; a newsletter does not.
3. Completing a linked task in Redstone transitions the Jira issue; moving it in Jira updates Redstone — no loops, no duplicates.
4. A both-sides-changed conflict produces a Decision; resolving it applies the choice to both systems.
5. Every backlog item answers "what do I do first?" without opening the source system.

## 7. Open Questions

- Per-source extraction sensitivity (aggressive vs. conservative task detection) — ship conservative defaults with per-source slider.
- Whether subtask steps should optionally sync to Jira subtasks — post-MVP.
