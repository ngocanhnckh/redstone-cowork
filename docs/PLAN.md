# Redstone Cowork — Project Plan

> **Pivoted 2026-06-26.** Cowork is now **a cognitive-load-efficient control plane for coding agents**, not a simulated-company assistant. The connector / virtual-team / situation-room scope moved to the separate **redstone-agent** project; Cowork consumes it only through a bridge. Design source of truth: [`superpowers/specs/2026-06-26-remote-agent-control-plane-design.md`](./superpowers/specs/2026-06-26-remote-agent-control-plane-design.md). Visual reference: [`superpowers/specs/assets/cockpit-focus-theater.html`](./superpowers/specs/assets/cockpit-focus-theater.html).

## 1. Context

Developers run several coding agents (Claude Code) across machines and multitask to avoid dead time while agents work — but juggling desktops, IDE windows, and SSH sessions is its own cognitive tax. Cowork removes it: see any session's latest output from anywhere, get pulled to whichever session needs you next, answer it, and let the UI **auto-advance** to the next — on desktop, mobile, or browser. Plus remote debugging (port-forwarding), file preview/edit, and pulling project context into a session via an injected MCP to redstone-agent.

**Deployment model:** self-hosted, single user per instance, Docker Compose; public via a cloudflared tunnel. Currently live on `youruser@your-server.example.com` → `cowork.example.com` (see [`superpowers/.../m1-done-live-access`] memory / `deploy/remote.sh`).

**Platforms (priority order):** **Desktop (Electron)** → **Mobile (React Native)** → Browser (shared renderer). Apple Watch is post-MVP.

## 2. The one job

> See, triage, and answer every coding-agent session from one calm surface — never juggling windows, never leaving dead time — with remote debugging and on-demand project context.

What Cowork explicitly does **not** own (lives in redstone-agent): connectors (Jira/Mattermost/Gmail/Calendar/Outlook), the virtual team, task-sync, the situation room. Cowork reaches that context via (a) an **MCP injected into each session** and (b) a **server-to-server bridge** for the backlog.

## 3. Architecture summary

Control plane vs data plane (full detail in the design doc):

- **Cowork server (`apps/api`, NestJS hexagonal)** — the universal hub. Sessions · decisions · **waiting queue** · summaries · notifications · **credential vault** (encrypted SSH/host/port-maps) · file proxy · port proxy · **agent bridge** → redstone-agent. Capable of everything so mobile/browser are first-class.
- **Agent host (`apps/hook-cli` v2)** — runs on each dev machine, wraps Claude Code. Holds one **persistent outbound WS** to the server; streams latest-answer/todos/summary; serves **local files** and **local `localhost:PORT`** up the WS; **injects the redstone-agent MCP** into sessions; registers an SSH target for the desktop fast lane.
- **Desktop (`apps/desktop`, new — Electron + shared React renderer)** — the **Focus Theater** cockpit; opens direct SSH for the port-forward fast lane.
- **Mobile (`apps/mobile`)** — notifications, answer-anywhere, file preview, session switching; all via the server.
- **`packages/shared`** — Zod types · **`prompts/`** — Jinja `.md` templates (e.g. rolling-summary) · **`apps/worker`** — schedulers/pollers.
- **Data:** Postgres (system of record), Qdrant (kept for future semantic search). Per-instance Docker Compose.

## 4. Status of prior work

- **M0 Foundation** — done. Monorepo, Docker Compose, hexagonal skeleton, shared Zod, Jinja prompts, instance auth. *Backbone — survives the pivot.*
- **M1 Hook & notifications / decision relay** — done & live. Hook CLI attaches a session, captures decisions, push to phone, answer routed back to the session anywhere. **This is the seed of the control plane** and is reused directly.
- **M2 connectors (Jira/Mattermost/Gmail/Calendar/Outlook)** — built, but **out of scope going forward**; treated as legacy and slated to migrate to redstone-agent. Not extended further in Cowork.

## 5. Forward milestones (the pivot)

### CP1 — Control-plane server v2 + agent-host state *(first build)*
Extend the session model with rich state (latestAnswer, rolling **summary**, **session todos**); derive the **waiting queue** (ordered, snooze/pin); define **auto-advance** + idempotent-answer + multi-device fan-out semantics; agent host streams latest-answer/todos/summary up its WS.
**Exit:** two attached sessions on one machine appear in the queue; answering the focused one (from an API client) auto-advances the queue; logic covered by Vitest.

### CP2 — Desktop app: Focus Theater (first vertical slice)
`apps/desktop` (Electron + shared React renderer, liquid-glass). Queue rail + focus stage with **live transcript**, **summary**, **session-todo checklist**, pinned answer dock; **answering auto-advances**. Flow/Browse modes; OS notifications + tray.
**Exit:** the cockpit renders live sessions from CP1 and you answer + auto-advance entirely from the desktop app.

### CP3 — Files & artifacts
Agent-host **file service** (read **and edit**); the **artifact drawer** — code (line numbers, editable), image preview, and **URL live-iframe + open-in-new-tab**; editable file browser in the context column.
**Exit:** open + edit a project file and preview a URL artifact from the cockpit; edits save back to the host.

### CP4 — Remote debugging (port-forwarding)
**Credential vault** (encrypted SSH/host/port-maps); desktop **SSH `-L` fast lane**, auto-configured per project; server **port proxy** (authenticated URLs) so mobile/browser can view forwarded apps.
**Exit:** forward a remote `:3000` and open it from the desktop (native localhost) and from a browser (proxied URL).

### CP5 — redstone-agent bridge + MCP injection
Inject the redstone-agent **MCP** into each session (pull discussions, pick next task); **server bridge** renders the **backlog** half of the cockpit checklist.
**Exit:** within a session, pull a Jira task via the injected MCP; the project backlog renders alongside session todos in the cockpit.

### CP6 — Mobile app
React Native: push notifications, answer-anywhere (multiple-choice + custom), file preview, session switching — all via the server.
**Exit:** answer a waiting session and preview a file from the phone; desktop reflects it live.

### Dependency graph
```
M0 ─→ M1 ─→ CP1 ─→ CP2 ─→ CP3 ─→ CP4
                     └────→ CP6 (mobile reuses CP1–CP3 server work)
            CP5 attaches once redstone-agent's interface lands
```

## 6. Working agreements (unchanged)

- Hexagonal: domain core has zero framework/SDK imports; everything external behind a port. Composition root in `app.module.ts` (Postgres when `DATABASE_URL` set, in-memory otherwise — tests need no DB).
- **Agent-host invariant:** never break a user's Claude session — every path catches errors and exits cleanly.
- All system prompts live in `prompts/**/*.md`, rendered with Jinja — never hardcoded.
- Shared types defined once in `packages/shared` (Zod), consumed by API/desktop/mobile.
- Desktop/mobile UI uses the **liquid-glass-frontend** skill (Warm Ink: clay = the action, amber = waiting on you).
- TDD for behavior-bearing code; every milestone ends with a runnable end-to-end demo (its Exit criterion).
- Report progress to Jira (RCW) + Mattermost; push to GitHub at each task; never run Docker on the Mac (use `deploy/remote.sh`).
