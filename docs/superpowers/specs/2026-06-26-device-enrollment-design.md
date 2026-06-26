# Device Enrollment — one-line install (Design)

> **Status:** approved 2026-06-26. Lets any server/device connect its Claude Code sessions to the user's Cowork instance via a single copy-paste command generated from the hosted website. Part of the Agent-host onboarding (CP track). Builds on the existing `apps/hook-cli` (`redstone init` + `redstone hook`).

## Goal

From the hosted instance (logged in), generate a one-liner that installs + configures the `redstone` host CLI on a fresh machine using a **per-device, revocable token** — the master `INSTANCE_TOKEN` never leaves the user's own machines.

## Flow

1. Website **Settings → Devices** (authenticated): name a device, click **Generate** → page shows a copy-able one-liner with a freshly minted device token:
   ```
   curl -fsSL https://cowork.example.com/install.sh | bash -s -- \
     --server https://cowork.example.com --token rcwd_<random>
   ```
2. Paste on the target. `install.sh` (public, served by the instance): checks Node ≥ 20 → downloads the prebuilt `redstone.js` bundle from the instance → installs a `redstone` launcher in `~/.local/bin` → runs `redstone init --server … --token …` → prints next steps (`cd <project> && redstone hook && claude --resume`).
3. That device's sessions talk to the server with its own token. The Devices page lists it (label + last-seen) and can **revoke** it (one click kills only that device).

## Security model

- Device tokens are random secrets with prefix `rcwd_`, stored **hashed (SHA-256)** at rest. Plaintext is returned **once** at generation and never again.
- The API auth guard authorizes a request if the bearer is **either** the master `INSTANCE_TOKEN` **or** a valid non-revoked device token (and bumps that device's `lastSeenAt`).
- **Device management** (mint/list/revoke `/devices`) requires the **master** token only — a device token cannot mint more devices. The guard tags each request's auth kind (`instance` vs `device`); `/devices` requires `instance`.
- `GET /install.sh` and `GET /install/redstone.js` are **public** (unauthenticated, like `/health`) — they carry no secret. The only secret is the token the user pastes into the command.

## Components

### Shared (`packages/shared`)
- `DeviceTokenSchema` — public view `{ id, label, createdAt, lastSeenAt|null, revokedAt|null }` (never the token/hash). `NewDeviceSchema` `{ label }`. `MintedDeviceSchema` = public view + `token` (returned once).

### Server (`apps/api`)
- **Domain:** `device-token-store.port.ts` — `DeviceTokenStore { create(rec), listActive(), findByHash(hash), touch(id, at), revoke(id, at) }`. Token token-hash is the lookup key.
- **Persistence:** in-memory + Postgres + migration `008_devices.sql` (`devices(id uuid pk, token_hash text unique, label text, created_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz)`).
- **Application:** `DevicesService` — `mint(label)` generates `rcwd_<32-byte base64url>`, stores its SHA-256, returns the plaintext once; `list()`; `revoke(id)`; `verify(token): Promise<{ id } | null>` (hash → findByHash → null if missing/revoked; touch lastSeen).
- **HTTP:** `DevicesController` — `POST /devices` (mint, body `{label}`), `GET /devices` (list active), `DELETE /devices/:id` (revoke). All require **master-token** auth.
- **Auth guard:** extend `InstanceTokenGuard` so a non-instance bearer is checked against `DevicesService.verify`; on success attach `req.authKind = "device"` (else `"instance"`). A small `@MasterTokenOnly` mechanism (guard or check) restricts `/devices` to `authKind === "instance"`.
- **Install endpoints (public):** `InstallController` (no guard) — `GET /install.sh` returns the script (text/plain) with the bundle URL derived from `OAUTH_REDIRECT_BASE`/request host; `GET /install/redstone.js` streams the bundled CLI (application/javascript).

### Bundle (`apps/hook-cli`)
- esbuild step → single-file `dist/redstone.bundle.js` (platform node, CJS). Built in the API Docker image (or copied in) so the API can serve it. Add `build:bundle` script.

### Web (`apps/web`)
- **Devices page** (authenticated, under the existing app): input a device name → `POST /api/proxy/devices` → render the one-liner with the returned token + a **Copy** button + a one-time "save this now" note. Below: list of devices (label, last-seen, **Revoke**). Liquid-glass styling consistent with the app.

### install.sh (served)
- `set -euo pipefail`; parse `--server`/`--token`; check `node -v` ≥ 20 (else print how to install Node, exit 1); `mkdir -p ~/.redstone ~/.local/bin`; `curl -fsSL $SERVER/install/redstone.js -o ~/.redstone/redstone.js`; write `~/.local/bin/redstone` launcher (`#!/bin/sh\nexec node "$HOME/.redstone/redstone.js" "$@"`) + chmod +x; run the launcher `init --server --token`; print PATH note (if `~/.local/bin` not on PATH) + next steps. Idempotent / re-runnable (updates the bundle).

## Error handling
- Node missing/old → clear message + exit 1 (no partial install).
- Download failure → exit 1 with the URL that failed.
- Revoked/unknown device token at runtime → API returns 401; the hook-cli already exits 0 silently (never breaks a Claude session) and the session simply won't appear until re-enrolled.
- Minting requires master token; a device token calling `/devices` → 403.

## Testing
- `DevicesService`: mint returns plaintext once + stores only the hash; `verify` accepts valid, rejects unknown + revoked, and touches lastSeen; list hides hash/token.
- Guard e2e: instance token works; a minted device token works on `/sessions`; a device token is **rejected (403)** on `/devices`; bad token → 401.
- `/install.sh` e2e: 200 text/plain, contains the bundle path + arg handling; `/install/redstone.js` 200 application/javascript, non-empty.
- `install.sh` static check (shellcheck) + arg-parse smoke.

## Scope (YAGNI)
- Node assumed present (≥20); no Node bootstrap. No per-device scopes (single-user instance — device tokens have full access, just revocable/tracked). No standalone binaries. The one-liner installs + configures + prints next steps; it does **not** auto-install project hooks (that's `redstone hook`, per-project).
