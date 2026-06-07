# Research: Claude Code Hook Surface for Session Attach & Remote Answering

> M1 spike (2026-06-07). Source: claude-code-guide agent over current Claude Code docs. Decision-grade findings for PRD 001.

## Findings

1. **Hook events** fire with JSON on stdin (`session_id`, `cwd`, `hook_event_name`, event fields). Relevant: `SessionStart`, `UserPromptSubmit`, `Stop` (fires on every completion; can block with `decision:"block"` + inject `additionalContext`; `stop_hook_active` guards loops, ~8 block max), `PreToolUse` (blockable, `permissionDecision: allow|deny|ask`), `PermissionRequest` (interactive only; carries full `AskUserQuestion` payload incl. `questions[].options[]`), `Notification` (`permission_prompt`, `idle_prompt`), `SessionEnd`.

2. **Blocking hooks are the answer channel.** A command hook may block (default timeout 600s, configurable per hook) while calling our server; returning JSON on stdout delivers the decision: permission allow/deny, or `AskUserQuestion` answers via `updatedInput`. Exit 0 with no output = fall through to the local terminal prompt (graceful timeout fallback).

3. **No direct message injection into a live interactive REPL.** No IPC/control protocol; `claude --resume <id>` from a second process interleaves/corrupts an open session; tmux send-keys is unsupported/fragile. → The relay is a **permission/answer gate**, not a message channel.

4. **Session identity**: every hook payload carries `session_id` + `cwd`; transcripts at `~/.claude/projects/<project-hash>/<session-id>.jsonl`.

5. **Hook config is file-scoped, not session-scoped** (user/project/local settings). Per-session attach must be emulated: install hooks inert (e.g. `.claude/settings.local.json`), handler no-ops unless the `session_id` is registered with the server.

6. **Headless/SDK differ**: `-p` mode fires no `PermissionRequest`; Agent SDK uses `canUseTool` callback (full control, indefinite block, `defer` support). M1 targets interactive CLI; SDK path arrives with the conversational layer (post-M1).

## Architecture consequences (supersede parts of PRD 001 technical notes)

- ~~Thin always-on relay holding session stdin via outbound WebSocket~~ → **stateless blocking hooks** that POST events and long-poll for resolutions. No daemon needed.
- Heartbeats: hook events double as liveness; an actively-blocked hook long-polling IS the heartbeat for `waiting` sessions. Idle sessions go `stale` honestly (no events until next prompt).
- Attach UX: `redstone hook` arms attach for the cwd; the next hook event from an unattached session in that cwd registers it (covers both already-running and new sessions). Never auto-attach beyond the armed window.
- Timeout fallback: on no answer within the hook budget, output nothing and exit 0 — the question falls back to the local terminal. Never break the user's session.
- Multiple-choice remote buttons: `AskUserQuestion` options are in the `PermissionRequest`/`PreToolUse` payload — render directly.

## Not viable (do not design around)

- Injecting arbitrary new user messages into a running interactive session
- Simultaneous `--resume` against an open session
- `PermissionRequest` hooks in headless mode
