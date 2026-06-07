# PRD 006 — Deployment: Single Instance & Bulk Multi-Employee

| | |
|---|---|
| Status | Approved |
| Milestone | M0 (foundations) · M6 (bulk hardening) |
| Master PRD | [000](./000-master-prd.md) |

## 1. Problem

Two deployment realities:
1. **Individual:** one user self-hosts on their own machine/server — must be a simple `docker compose up`.
2. **Company shared server:** a company hosts instances for many employees on one box. Each employee needs a fully **isolated** instance (own data, own credentials, own Claude subscription) — and N instances must coexist **without port/volume/name collisions**, manageable in bulk.

One user per instance is a deliberate security property: credentials and Claude traffic never cross users.

## 2. Goal

A `deploy/` toolkit where a single instance is one command, and a fleet of employee instances is one manifest + one command — with automatic port allocation, optional reverse proxy, and an optional shared database server to keep resource usage sane.

## 3. User Stories

1. As an individual, I clone the repo, set 3–4 env values, run `docker compose up -d`, and my instance is live.
2. As a company admin, I list employees in a manifest and run `./deploy.sh apply`; each gets an isolated instance with auto-assigned, non-colliding ports.
3. As a company admin, I run `./deploy.sh add tuan` / `remove tuan` / `update-all` / `status` for day-2 operations.
4. As a company admin, I enable proxy mode so employees use `https://tuan.cowork.example.com` instead of port numbers.
5. As an employee on a shared server, my data, credentials, and Claude subscription are mine alone — the admin manages the containers, not my content.
6. As any operator, I can back up and restore an instance, and upgrades are one command with automatic DB migrations.

## 4. Functional Requirements

### Parameterized instance (M0)
- **FR-1** Every externally visible resource derives from env: `INSTANCE_ID` (names containers/volumes/network: `rcw-<id>-*`) and `PORT_BASE` (web = `PORT_BASE`, API = `+1`, anything else exposed = `+2…`). Defaults (`rcw-default`, `47100`) make single-user setup zero-config.
- **FR-2** Single `.env` file per instance holds all configuration; `.env.example` documents every variable. Credentials (`.creds`-style files, Claude credentials mount path) are referenced, never baked into images.
- **FR-3** Claude Agent SDK credential mount: the instance mounts the owner's Claude credentials read-only from a configured host path; documented per-OS. The server software never proxies or stores Anthropic credentials beyond that mount.
- **FR-4** Healthcheck endpoint per service; `docker compose ps` reflects real readiness.

### Bulk mode (M6)
- **FR-5** `deploy/employees.yaml` manifest: list of `{id, port_base (optional), subdomain (optional)}`. Omitted `port_base` auto-allocates the next free block (stride 10).
- **FR-6** `deploy.sh` subcommands: `apply` (reconcile manifest ↔ running instances), `add <id>`, `remove <id>` (prompts; data volume removal is a separate explicit flag), `update-all` (pull new images, migrate, rolling restart), `status` (table: instance, ports, health, version), `backup <id>` / `restore <id>`.
- **FR-7** Port collision safety: `deploy.sh` validates the full allocation (manifest + already-running containers) before touching anything; conflicts abort with a clear message.
- **FR-8** Proxy mode: generate Caddy (default) or Nginx config from the manifest — per-employee subdomain or path prefix → instance web port; TLS via Caddy auto-HTTPS when DNS allows.
- **FR-9** Shared-infra option: `SHARED_DB=true` deploys one Postgres server and one Qdrant server for the fleet, with **per-instance database / per-instance collection prefix + per-instance DB credentials**. Default remains fully isolated containers per instance.

### Isolation guarantees
- **FR-10** No instance can reach another's containers (per-instance Docker network; shared-DB mode enforces isolation via DB-level auth, not network trust).
- **FR-11** Volumes are per-instance and named by `INSTANCE_ID`; `remove` without the data flag always preserves them.

### Upgrades & ops
- **FR-12** DB migrations run automatically on container start (idempotent, versioned); `update-all` is therefore safe fleet-wide.
- **FR-13** Logs per instance via `docker compose logs` conventions; `status` surfaces failing healthchecks.

## 5. Technical Notes

- One canonical `docker-compose.yml` consumed by both modes — bulk mode templates `.env` files per instance and runs compose with `--project-name rcw-<id>`. No forked compose files.
- `deploy.sh` is POSIX shell (or a small Node script in `deploy/`) — no extra runtime dependencies on the host beyond Docker.
- Image publishing: GHCR images per release tag; `update-all` pins tags from a fleet-level `VERSION` file (no surprise `latest` drift).
- Resource guidance documented: per-instance RAM expectations with isolated vs. shared DB, to size shared servers.

## 6. Acceptance Criteria

1. Fresh machine → single instance live with only Docker installed, ≤ 5 commands, on custom `PORT_BASE`.
2. Manifest with 10 employees → `./deploy.sh apply` → 10 healthy isolated instances, zero collisions, `status` shows all green.
3. `add`/`remove` work without touching other instances; removed instance's data volume survives unless explicitly purged.
4. Proxy mode: employee reaches their instance via subdomain with TLS; no published ports required except 80/443.
5. Shared-DB mode: instance A's DB credentials cannot read instance B's database (verified by test).
6. `update-all` upgrades the fleet with migrations; all instances healthy after.

## 7. Open Questions

- Windows host support for bulk mode (Docker Desktop quirks) — document Linux-server-first; single-instance mode supports all platforms.
- Central admin dashboard for fleets — post-MVP; `status` covers MVP.
