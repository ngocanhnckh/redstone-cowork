# Redstone Cowork — agent instructions

Self-hosted AI cowork assistant: the user is the CEO of a simulated company; a virtual team ingests their work streams (Jira, Mattermost, Gmail, Calendar, Claude Code sessions) and relays decisions. Docs: `docs/PLAN.md` (milestones), `docs/prd/` (PRDs), `docs/TECH-DEBT.md`.

## Always do (standing rules)

- **Report progress to Jira and Mattermost** — not optional, the user relies on it:
  - Jira project **RCW** at `https://jira.examplehost.group` — comment on the matching milestone issue (RCW-2…RCW-8 = M0…M6) when starting/finishing significant work; transition status (Backlog 11 / Selected 21 / In Progress 31 / Done 41).
  - Mattermost channel **redstone-cowork** (id `xy6ffti36pd97mosgemaagmuoy`) at `https://mattermost.examplehost.group` — post a progress update at every milestone completion and any notable event (deploy, blocker, decision needed).
  - Credentials: `.creds` at repo root (gitignored): `JIRA_PAT`, `JIRA_ENDPOINT`, `MATTERMOST_PAT`, `MATTERMOST_ENDPOINT`. Jira is self-hosted Data Center: `Authorization: Bearer $JIRA_PAT`, API `/rest/api/2/...`.
- **Push to GitHub regularly** (`ngocanhnckh/redstone-cowork`, private) — at least at every task completion.
- **Never run Docker on this Mac.** Use `deploy/remote.sh {sync|init|build|up|down|logs|ps|smoke}` against the dev server (`youruser@your-server.example.com`, dir `/home/youruser/redstone-cowork`). Public via a cloudflared token tunnel → `cowork.example.com`.
  - **Always restart `web` after rebuilding `api`.** Recreating only the `api` container (`docker compose up -d --build api`) gives it a new internal IP, but the `web` container (the Next.js proxy the desktop + browser talk through) keeps stale keep-alive connections to the old API IP → `ECONNREFUSED` → sessions fail to connect. So finish an API deploy with `docker compose restart web` (or rebuild both: `up -d --build`). Symptom to recognize: web container `unhealthy` + `ECONNREFUSED <old-ip>:3001` in `docker compose logs web`.
- **Never commit secrets** — `.creds`, `.env*` (except `.env.example`) are gitignored; keep it that way.

## Architecture rules

- **Hexagonal**: domain owns ports (`apps/api/src/domain/**/*.port.ts`, framework-free); use cases in `application/`; adapters in `adapters/{http,persistence}/`. Composition root = `app.module.ts` factories (Postgres when `DATABASE_URL` set, in-memory otherwise — tests need no DB).
- **All system prompts** live as `.md` Jinja templates under `prompts/` (rendered with Nunjucks via `PromptLoader`) — never hardcoded.
- **Shared types** defined once in `packages/shared` (Zod v3, ESM); apps import types/schemas from `@rcw/shared`.
- **Migrations**: plain SQL in `apps/api/migrations/NNN_name.sql`, run idempotently on container start by `migrate.ts`.
- **Hook handler invariant** (`apps/hook-cli`): must NEVER break a user's Claude session — every path catches errors and exits 0 silently; timeouts fall back to the local terminal.

## Conventions

- pnpm + Turborepo; Node 22; tests = Vitest (`pnpm test` at root). API tests use supertest against `AppModule` with in-memory stores.
- Ports: uncommon by design — web `47100`, API `47101` (host side, from `.env`); containers use 3000/3001 internally.
- Conventional commits (`feat(api): …`, `fix(deploy): …`); TDD for behavior-bearing code (failing test first).
- Instance auth: single `INSTANCE_TOKEN` bearer; `/health` is the only public endpoint.

## Process

- Milestone work follows a written plan in `docs/superpowers/plans/` (subagent-driven execution with spec + quality review per task).
- Milestone close: verify exit criteria live on the dev server, update `docs/TECH-DEBT.md`, push, report to Jira + Mattermost.
