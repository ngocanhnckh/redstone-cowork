# Redstone Cowork — Focus Theater Desktop

Electron + React cockpit for managing Claude Code sessions. Acts as the control
plane for your Redstone Cowork server: it shows a live queue of sessions waiting
for your input, lets you answer decisions, and notifies you via OS notifications
and the system tray when new sessions need attention.

## Dev

```bash
# From the repo root:
pnpm install
pnpm --filter @rcw/desktop dev
```

On first launch you will see a login screen. Enter:

- **Server URL** — e.g. `https://cowork.example.com`
- **INSTANCE_TOKEN** — the bearer token configured on your server

The token is stored encrypted via Electron `safeStorage` in the OS user-data
directory. The renderer process never sees it in plain text.

## Build

```bash
pnpm --filter @rcw/desktop build   # compiles to out/
pnpm --filter @rcw/desktop start   # preview the built app
```

Output lands in `apps/desktop/out/`.

## Test & typecheck

```bash
pnpm --filter @rcw/desktop test        # Vitest unit suite
pnpm --filter @rcw/desktop typecheck   # tsc --noEmit
```

## Tray & notifications

While running, the app keeps a menu-bar tray icon. When sessions are waiting
the tray title shows the count (`⌥ 2`). When a *new* session enters the queue
and the app window is not focused, an OS notification fires with the title
"Claude needs you" and the repo name as the body. Clicking the notification
brings the window to the front.

## Connecting sessions

Point your `apps/hook-cli` installation at the same server URL and token. Each
Claude Code session will then appear in the cockpit queue as soon as it raises
a decision.
