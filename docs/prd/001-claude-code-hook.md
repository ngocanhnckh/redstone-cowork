# PRD 001 — Claude Code Hook & Notifications

| | |
|---|---|
| Status | Approved |
| Milestone | M1 |
| Depends on | M0 foundation |
| Master PRD | [000](./000-master-prd.md) |

## 1. Problem

Developers run Claude Code sessions on laptops and remote servers. Sessions block on questions ("which approach for feature X?"), permission prompts, or simply finish — and the developer doesn't notice while multitasking. Answering requires SSH-ing back into the right machine. This is the #1 source of agent dead time.

## 2. Goal

Attach any Claude Code session, on any machine, to the user's Redstone Cowork server with **one command** — then receive every question/completion as a notification on web and phone, and answer it from there. The answer is injected back into the originating session automatically.

## 3. User Stories

1. As a dev, I run one command on any server/PC and my current Claude Code session is hooked to my Redstone instance.
2. As a dev, when Claude finishes a task or asks a question, I get a push notification with a summary and response options (multiple choice + custom reply).
3. As a dev, I tap an option (or type a custom reply) on my phone and Claude continues on the remote machine without me logging in.
4. As a dev, I see all my live sessions (machine, project, status, last activity) in one list.
5. As a dev, if a session dies or disconnects, I'm told — no silent black holes.

## 4. Functional Requirements

### Session attach
- **FR-1** `hook-cli` installable via one shell command (`curl … | sh` or `npm i -g`); configured once with server URL + instance token.
- **FR-2** Attaching is per-session and explicit: a command (e.g. `redstone hook`) registers the *current* Claude Code session. New sessions are never auto-attached.
- **FR-3** The CLI installs Claude Code hooks (Stop / Notification / permission-prompt events) scoped to that session, plus a lightweight relay that maintains an outbound WebSocket to the server (works behind NAT — no inbound ports on the dev machine).
- **FR-4** Sessions register with: machine name, working directory, git repo/branch if present, session id. Heartbeat every ≤30s; missed heartbeats mark the session `stale`, then `lost`.

### Decision capture
- **FR-5** Captured events: task completed (with result summary), question asked (with context), permission requested, error/crash.
- **FR-6** Each event becomes a **Decision** record: title, LLM-generated summary, source session, options. Options come from Claude's own question when enumerable; otherwise the server generates sensible multiple-choice options + always a custom-reply field.
- **FR-7** Decisions are linked to a Project when the session's repo/directory maps to one (see PRD 002/003); unmapped sessions land in an "Unassigned" bucket.

### Notification & response
- **FR-8** Fan-out on decision creation: WebSocket to web app, push (FCM/APNs) to mobile. Notification shows summary + top options; expanding shows full context.
- **FR-9** Responding from any device resolves the decision exactly once (first answer wins; others see "already answered by you").
- **FR-10** The response is injected into the originating Claude Code session via the relay; injection result (accepted / session gone) is reported back to the user.
- **FR-11** If the session is `lost`, the decision stays open and is flagged; the user is told the answer can't be delivered.

### Session list
- **FR-12** Web + mobile show all sessions: status (active/waiting/stale/lost), machine, project, last event, pending decision count.

## 5. Technical Notes

- **Protocol:** versioned JSON over WebSocket (`hook-protocol v1`); the relay is intentionally thin — capture, forward, inject. All intelligence lives server-side. This isolates us from Claude Code version churn.
- **Injection mechanism:** prefer Claude Code's native mechanisms for responding to a prompt within an existing session; the relay holds the session's stdin/control channel. Validate against current Claude Code hook capabilities during M1 spike (first task of the milestone).
- **Security:** instance token authenticates the relay; per-session secrets rotate on attach. The server never sees the user's Anthropic credentials — those stay on the dev machine.
- **Hexagonal fit:** `AgentSessionPort` (attach, heartbeat, inject) with the WebSocket relay adapter; `NotifierPort` with WS + FCM/APNs adapters.
- Decision summaries via conversational tier (LangChain) using prompts from `prompts/decisions/*.md`.

## 6. Acceptance Criteria

1. Attach a session on a remote Linux server; question from Claude appears as phone push within 5s of the event.
2. Tap an option on the phone → Claude continues on the server; round-trip without touching the server.
3. Custom text reply works equivalently.
4. Kill the relay process → session shows `lost` on web within 90s; pending decision flagged as undeliverable.
5. Two devices race to answer → exactly one answer is injected.

## 7. Open Questions

- Exact Claude Code surface for mid-session injection (hooks vs. controlling terminal) — resolve in M1 spike.
- Apple Watch quick-reply (post-MVP) rides on the same decision/notification model — no schema changes anticipated.
