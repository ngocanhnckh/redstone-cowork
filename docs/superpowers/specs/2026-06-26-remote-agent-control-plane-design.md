# Redstone Cowork — Remote Agent Control Plane (Design)

> **Status:** approved design (2026-06-26). Supersedes the "simulated company / virtual team" framing in `docs/ABOUT.md` and PRDs 002–005, whose connector/virtual-team/situation-room scope now lives in the separate **redstone-agent** project. Visual reference: [`assets/cockpit-focus-theater.html`](./assets/cockpit-focus-theater.html).

## 1. The pivot

Redstone Cowork is **a cognitive-load-efficient control plane for coding agents**. Developers multitask because they wait on coding agents (Claude Code) and must not leave dead time — but juggling desktops, IDE windows, and SSH sessions across machines is its own tax. Cowork removes that tax:

- See the latest output of **any** Claude Code session, from **anywhere**, on **any device** (desktop, mobile, browser).
- Get pulled to whichever session needs you next; answer it; the UI **auto-advances** to the next waiting one.
- Pull project/task context into a session on demand (via an injected MCP to redstone-agent).
- Debug remotely (port-forwarding) and preview/edit files — without opening a terminal.

**One sharp job, beautifully executed.** Everything that smells like "ingest work streams / virtual team / situation room" belongs to **redstone-agent**, which Cowork consumes only through a bridge.

## 2. Boundary with redstone-agent (decided)

**Cowork = pure control plane.** It stores only sessions, decisions, the waiting queue, and credentials. **redstone-agent owns all project/task context** (Jira tickets, Mattermost discussions, backlog). Cowork reaches it two ways:

1. **Injected MCP** — the agent host injects an MCP server into each Claude Code session so the user (through Claude) can pull context: "grab recent discussion on feature X", "pick up the next Jira task".
2. **Server-to-server bridge** — Cowork's server calls redstone-agent to render the *project backlog* half of the cockpit's checklist.

Cowork re-implements **no connectors**.

## 3. Architecture — control plane vs data plane

The server is the **universal hub**: it is capable of everything, so mobile and browser clients are first-class. The desktop additionally gets a fast lane.

```
   DESKTOP (Electron)        MOBILE (React Native)        BROWSER
        │  fast path: ▲             │                        │
        │  direct SSH  │            │   ── all control + data plane ──┐
        ▼              │            ▼                        ▼        │
┌───────────────── COWORK SERVER (apps/api) — universal hub ──────────▼──┐
│  Sessions · Decisions · Waiting Queue · Summaries · Notifications      │
│  Credential Vault (encrypted SSH keys, host info, per-project ports)   │
│  File proxy · Port proxy (auth'd URLs) · Agent Bridge → redstone-agent │
└───────────────────────────▲───────────────────────────────────────────┘
                            │ one persistent outbound connection (WS)
┌───────────────────────────┴─────── AGENT HOST (hook-cli v2) ───────────┐
│  Wraps Claude Code · streams latest answer + todos + summary           │
│  Serves LOCAL files + LOCAL localhost:PORT up through the WS            │
│  Injects redstone-agent MCP into the session                           │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key idea:** the agent host runs *on* the dev machine, so it already has local access to that project's files and its own `localhost:PORT`. It relays them up its single outbound WS to the server, which makes the server universally capable **without** needing inbound reachability to hosts.

How each capability reaches every device:

| Capability | Path |
|---|---|
| Latest answer / summary / todos / decisions | host → WS → server → fan-out to all clients |
| File preview **& edit** | client → server → host (over WS) → read/write local file → back |
| Port-forward / live URL (mobile, browser) | host relays `localhost:PORT` up → server exposes an **authenticated proxy URL** |
| Port-forward (desktop fast lane) | desktop fetches SSH creds from the vault → native `ssh -L` → real local `localhost:PORT` |

**Credential vault:** SSH keys, host/user, per-project port maps — encrypted at rest (reuse the existing `CredentialCipher`, AES-256-GCM). The desktop fetches what it needs to open SSH; the server uses the same vault to reach hosts for thin clients.

## 4. The cognitive-load engine (server-side logic)

**Session states:** `working` (running, needs nothing) · `waiting` (hit a decision: finished / needs input / asks permission; carries a `pendingDecision` of multiple-choice options + custom-reply-allowed) · `answered` (relayed → returns to `working`) · `done` · `lost` (heartbeat gone).

**The queue** is *derived* server-side: every session in `waiting`, across all projects/machines, ordered by `(pinned, waitingSince ascending)` — **longest-waiting first** so nothing starves. Snoozed sessions drop out until their timer fires.

**Two modes** (queue is the spine, browse is the escape hatch):
- **Flow mode** — cockpit focuses *one* waiting session. Answer → relay → it leaves `waiting` → **focus auto-advances to the new first item**. Empty queue → calm "all clear" rest state.
- **Browse mode** — manually inspect any session (even `working`/`done`).

**Humane rules:** auto-advance fires only *after submit* (never yanks focus mid-typing); **Skip / Snooze(15m)** defers without losing a session; **focus is per-device, the queue is shared** (answer on phone → desktop advances too — server is the single source of truth for the set+order, each client holds its own focus pointer).

**Edge handling:** relay fails (host offline) → session stays `waiting`, error shown, no advance · two devices answer same session → server is **idempotent** (first wins, second gets "already answered") · session goes `lost` while waiting → leaves active queue, surfaced separately.

## 5. The desktop cockpit — "Focus Theater"

Electron + a **shared React renderer**, built with the **liquid-glass-frontend** skill (Tailwind v4 glass utilities, motion.dev, Warm Ink palette: clay/tomato `229 77 46` = *the action*, amber `226 169 91` = *waiting on you*). Three-zone layout:

- **Queue rail (left):** waiting sessions (project initial, name, wait time, status); an amber pulse marks the focused one; below, a muted "N working" mini-list with progress bars.
- **Stage (center):** fixed header (status pill · large session title with breathing room · host/branch/session **metadata chips**) → **scrollable transcript** of the full Claude output (messages, tool runs, code), opening scrolled to the latest → **pinned answer dock** (multiple-choice options + custom reply + Skip/Snooze) that stays reachable however far you scroll.
- **Context column (right):** a **scrollable, height-capped Summary** (project + where the session stands) → **dual checklist** tabs (Session todos from the hook · Backlog from redstone-agent) → **file browser** (rows are **editable** — pencil affordance) → forwarded ports.

**Artifacts** — when an answer carries important output, chips appear in the transcript and a **drawer pops out on the right** handling three types:
- **Code** — line numbers + syntax colors, **editable** (saves back to the host over the agent channel).
- **Image** — inline preview (screenshots of what was built).
- **URL** — **live iframe** with a mini browser chrome + an **"Open in new tab ↗"** button; ties into forwarded ports (a forwarded `localhost:3000` becomes a previewable URL).

The signature moment: the **auto-advance hand-off** — the focused glass card sliding away as the next session flows into the stage, on the skill's house easing curve.

## 6. Components & data model

**Server (`apps/api`, extend):**
- `Session` { id, hostId, project, status, waitingSince, latestAnswer, summary, todos[], pendingDecision? } — extends today's session registry.
- `Decision` (exists) — multiple-choice + custom reply, idempotent answer.
- Queue is derived (not stored): a query/projection over `waiting` sessions.
- `CredentialVault` — encrypted host/SSH/port-map records (new, reuse `CredentialCipher`).
- `AgentBridge` port → redstone-agent (backlog fetch + MCP descriptor). Stub until redstone-agent's interface lands.
- Real-time fan-out over the existing WS/SSE + push.

**Agent host (`apps/hook-cli`, evolve to v2):**
- Already wraps Claude Code + reads the transcript. Add: push latest-answer/todos/summary; a **file service** (read/write local files); a **port relay** (stream local `localhost:PORT`); **MCP injection** into launched sessions; an SSH-target registration (host/user/project port-map) for the desktop fast lane.

**Desktop (`apps/desktop`, new — Electron + shared renderer):** subscribes to the control plane, renders Focus Theater, opens direct SSH for the port-forward fast lane + direct file reads.

**Mobile (`apps/mobile`, later):** notifications + answer-anywhere + file preview + session switching; all via the server.

## 7. Decomposition & build order

Independently-buildable pieces, built in this order:

1. **Control-plane server v2** — session rich-state, waiting queue, summaries, real-time fan-out.
2. **Agent host v2** — stream latest-answer/todos/summary; (then) file service, port relay, MCP injection.
3. **Desktop app** — Focus Theater cockpit. *(start here per the user)*
4. **Mobile app** — later.

**First slice (the slimmest vertical cut through 1→2→3):** one machine, one or more attached sessions; the desktop renders the queue rail + focus stage with **live transcript, summary, and session-todo checklist**, and **answering auto-advances** to the next waiting session — over the existing hook→server→push backbone. *Deferred to follow-on slices:* file preview/edit, artifacts (code/image/URL), port-forwarding, the redstone-agent MCP bridge + backlog half of the checklist, mobile.

## 8. Error handling & testing

- **Hook invariant preserved:** the agent host must never break a user's Claude session — every path catches and exits cleanly (existing rule).
- **Server logic is pure & testable** with in-memory stores (matches today's Vitest+supertest approach): queue ordering, auto-advance state machine, idempotent answer, multi-device fan-out, credential encryption round-trip.
- **Desktop:** component tests for the renderer; the SSH/port-forward native layer behind a port so it's mockable.
- **Degraded modes:** host offline → sessions show `lost`, queue excludes them; agent-bridge down → backlog section shows "unavailable", session-todo half still works; vault unconfigured → port-forward fast lane hidden, server proxy still offered.

## 9. Hexagonal & house rules (unchanged)

Domain core stays framework-free; connectors/notifications/agent-bridge/file-service/port-relay are **ports** with adapters. Shared types in `packages/shared` (Zod). Prompts (e.g. the rolling-summary prompt) as `.md` Jinja templates under `prompts/`. Migrations as idempotent SQL. Single `INSTANCE_TOKEN` auth; web cookie `rcw_token`.
