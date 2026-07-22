# Redstone Cowork

**One calm surface for every Claude Code session you're running — on any machine.**

Redstone Cowork is a self-hosted **control plane for coding agents**. Your Claude Code
sessions run wherever you code (laptops, VPSes, dev servers); Cowork gathers them into a
single cockpit so you can see what each one is doing, jump on the ones that need an answer,
and reply — from your desktop or your phone — without SSH-ing into each box. When a session
finishes or asks a question, it surfaces in a waiting queue that auto-advances, so multitasking
across many agents stops leaking dead time.

The cockpit gives each session a live **terminal**, an in-app **browser** (with point-and-prompt
feedback tools), an editable **file browser**, **port forwarding**, and host **telemetry** — all
proxied through the server so mobile and browser are first-class.

> Self-hosted, single user per instance, Docker deployment. Uses your own Claude subscription.

---

## Install the server (any Linux VPS)

One line — it picks a free port pair (asking you to confirm), generates your login token, and
brings the stack up:

```bash
curl -fsSL https://raw.githubusercontent.com/ngocanhnckh/redstone-cowork/main/install.sh | bash
```

It will:

1. install Docker if it's missing (with your OK),
2. clone the repo to `~/redstone-cowork`,
3. scan for a **free, uncommon host-port pair** and show it for confirmation,
4. generate a unique instance token + database password,
5. build and start the containers, and
6. print your **URL** and **login token**.

Sign in at `http://<server-ip>:<web_port>` with the printed token (it *is* your password —
keep it secret; anyone with it controls the instance). For a public HTTPS address, point a
reverse proxy or a Cloudflare tunnel at the web port.

Re-running the installer against an existing checkout leaves your `.env` (ports + token)
untouched. Manage the stack with `cd ~/redstone-cowork && docker compose {ps,logs,down}`.

**Env knobs:** `RCW_DIR` (install location), `RCW_BRANCH`, `RCW_REPO_URL`.

## Get the desktop app

Download the cockpit for **macOS**, **Windows**, or **Linux** from the
[**latest release**](https://github.com/ngocanhnckh/redstone-cowork/releases/latest):

| Platform | File |
|----------|------|
| macOS    | `Redstone Cowork-<version>.dmg` (or `.zip`) |
| Windows  | `Redstone Cowork-<version>-Setup.exe` |
| Linux    | `.AppImage` or `.deb` |

The builds are unsigned, so the first launch needs a one-time bypass: on macOS right-click →
**Open**; on Windows click **More info → Run anyway**. Point the app at your server URL and sign
in with the same instance token.

## Connect a machine

To make a machine's Claude Code sessions show up in the cockpit, run the Redstone agent on it
(it reports sessions + host telemetry and relays your answers back). See
[`docs/prd/006-deployment.md`](docs/prd/006-deployment.md) and the enrollment flow in the app's
**Settings → Hosts**.

---

## Architecture

- **`apps/api`** — the hub: sessions, decisions, the waiting queue, summaries, credential vault,
  file/port proxy, host telemetry, and the agent bridge.
- **`apps/web`** — Next.js server that the desktop and browser talk through.
- **`apps/worker`** — background jobs / heartbeats.
- **`apps/desktop`** — the Electron cockpit (shared React renderer).
- **Postgres + Qdrant** — persistence and vector store.

Hexagonal API (domain ports → use cases → adapters), shared Zod types in `packages/shared`,
prompts as Jinja templates under `prompts/`. See `CLAUDE.md` for the conventions.

## Develop

```bash
pnpm install
pnpm test                       # all packages (Vitest)
pnpm --filter @rcw/desktop dev  # run the cockpit against a server
```

Ports are uncommon by design — web `47100`, API `47101` (host side, from `.env`); containers
use 3000/3001 internally.

**Building the desktop app into installers** (Windows/macOS/Linux) is documented in
[**docs/BUILD.md**](docs/BUILD.md) — note it needs a C++ toolchain for the native `node-pty`
module, and each platform's installer must be built on that platform.

## Docs

- [Building the desktop app](docs/BUILD.md)
- [Project plan & milestones](docs/PLAN.md)
- [Deployment](docs/prd/006-deployment.md)
- [Tech debt](docs/TECH-DEBT.md)
- [Vision / history](docs/ABOUT.md) *(pre-pivot, kept for context)*

## Releasing

Desktop binaries are built by [`.github/workflows/release.yml`](.github/workflows/release.yml)
on macOS/Windows/Linux runners and attached to a GitHub Release. Cut one by pushing a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```
