# Session Workspace Tabs (Chat · Terminal · Browser) — Design

**Date:** 2026-06-27
**Status:** Approved (brainstormed with CEO)

## Goal

Turn the cockpit's center column (`FocusStage`) into a per-session workspace with three
tabs — **Chat** (today's transcript), **Terminal** (a real shell in the project dir), and
**Browser** (a Chromium preview of a forwarded dev-server URL). Add a per-session config
(saved in the project folder) for SSH host, ports to forward, and the browser URL. Wire
keyboard shortcuts for tab switching and print shortcut hints on actionable buttons.

## Decisions (from brainstorming)

- **Connectivity: existing SSH.** Terminal attaches over `ssh`, ports forwarded with `ssh -L`,
  browser hits `localhost:PORT`. Local sessions (machine == this Mac) skip SSH.
- **Terminal: a fresh interactive shell** in the session's project dir (not Claude's pane).
- **Config file: `.redstone/session.json`, gitignored**, written to the project folder on the host.
- **SSH host: typed per session** in the Configure panel (works with `~/.ssh/config` aliases).
- **Incremental delivery**, each increment merged and usable on its own.

## Architecture

Electron **main** process owns all OS/SSH work (node-pty, ssh children, fs over ssh);
the **renderer** is xterm.js + `<webview>` + React UI, talking over IPC. The cowork server
is **not** involved — workspace features are desktop↔host direct over SSH.

### Config — `.redstone/session.json`
```json
{ "sshHost": "contabo2", "forwardPorts": [5173, 8080], "browserUrl": "http://localhost:5173" }
```
- Lives in the project folder **on the host** (`<session.cwd>/.redstone/session.json`).
- Written over SSH for remote sessions; direct fs for local. Auto-appends `.redstone/` to the
  repo `.gitignore`. Desktop caches it locally (keyed by sessionId) to bootstrap the read
  without a chicken-and-egg on `sshHost`.

### Terminal
- `node-pty` spawns `ssh -tt <sshHost> "cd <cwd> && exec $SHELL -l"` (remote) or `$SHELL` in
  `cwd` (local). Rendered with **xterm.js**; bytes piped renderer↔main over IPC. Resize wired.
- Needs `@electron/rebuild` for the node-pty native module.

### Browser
- Electron `<webview>` (requires `webviewTag: true`) pointed at `browserUrl`, with
  back/reload/open-externally controls. Relies on the forwarded port.

### Port forwarding
- One `ssh -N -L PORT:localhost:PORT <sshHost>` child per configured port; started when the
  session's Terminal/Browser tab opens, torn down on close. Live status chip (forwarding/failed).

### Shortcuts + hints
- Global renderer key handler: `⌃1/⌃2/⌃3` select tab, `⌃Tab`/`⌃⇧Tab` cycle. Other actions:
  Send `⌅`, Skip `⌃→`, Snooze `⌃S`, mode cycle `⌃M`, answer options `1/2/3`.
- A reusable `<Kbd>` badge component renders a faint monospace hint on each button.

## Increments

1. **Tabs + shortcuts + hints + config panel** (renderer + config read/write over SSH). Desktop-only.
2. **Terminal** (xterm.js + node-pty over ssh/local; `@electron/rebuild`).
3. **Browser + port forwarding** (`<webview>` + `ssh -L` lifecycle).

## Risks

- `node-pty` native rebuild under electron-vite (Increment 2).
- `<webview>` enablement + sizing within the React layout (Increment 3).
