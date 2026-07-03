# NAT'd-host SSH relay (reverse tunnel via cowork server) — design

**Date:** 2026-07-03
**Goal:** Let the desktop cockpit reach hosts that have **no inbound SSH port** (behind NAT/firewall) for terminal, git, and browser port-forwarding — by relaying SSH through the cowork server over the agent's existing outbound connectivity.

**Approach:** Classic reverse SSH tunnel (`ssh -R`) brokered by a locked-down `rcwtun` user on the cowork server. SSH stays end-to-end (the relay only moves TCP bytes). Auto-fallback: try direct, else relay. Covers all three consumers at once.

## Why this works here
- The cowork/dev server `your-server.example.com` has **sshd reachable on :22** (used for deploys). Both the agent's `-R` and the cockpit's `-W` jump connect there directly (bypassing the Cloudflare HTTPS tunnel — fine for SSH).
- NAT'd hosts allow **outbound** :22 even when inbound is blocked.
- Reverse-forwarded ports bind to the relay's **loopback** (default sshd) → **no `sshd_config` change, no firewall opening, no lockout risk**. The cockpit reaches them by jumping through `rcwtun` with `-W localhost:<port>`.

## Components

### 1. Cowork server host setup (one-time, scripted in `deploy/`)
- Create user **`rcwtun`** (own home, e.g. `/home/rcwtun`), `~/.ssh` mode 700.
- **Do not edit global `sshd_config`** unless a probe shows `AllowTcpForwarding` is off (default is on). If needed, add only a narrow `Match User rcwtun` block. Never restart sshd without confirming existing sessions survive.
- Bind-mount `/home/rcwtun/.ssh` into the API container (read/write) so the API can manage `authorized_keys`.

### 2. Shared contract (`packages/shared`)
- `TunnelProvisionRequest { pubkey: string; kind: "agent" | "cockpit" }`
- `TunnelCoordinates { relayHost: string; relayPort: number; tunnelUser: string; tunnelPort: number }` (cockpit key registration returns only ack; agent provision returns full coordinates).

### 3. API (`apps/api`)
- Migration `023_host_tunnels.sql`: `host_tunnels(host_id text PK, tunnel_port int UNIQUE, agent_pubkey text, created_at timestamptz)`. Port pool from **30000**; assign lowest free.
- Port + key store behind a domain port (Postgres + in-memory adapters), like inventory.
- `AuthorizedKeysWriter` (application service): rebuilds `authorized_keys` from all stored agent keys + registered cockpit keys. Lines:
  - agent: `restrict,port-forwarding,permitlisten="localhost:<port>" <pubkey> agent:<hostId>`
  - cockpit: `restrict,permitopen="localhost:*" <pubkey> cockpit:<label>` (loopback-only egress on the relay)
  - Writes atomically to `RCWTUN_AUTHKEYS_PATH` (env; the bind-mounted `authorized_keys`). Never throws into request path.
- Endpoints (ExternalApiGuard — agent/device tokens; instance/redstone for cockpit):
  - `POST /hosts/:id/tunnel` (agent) — body `{pubkey}`; upsert host key, assign/return `TunnelCoordinates`, rewrite authorized_keys.
  - `GET /hosts/:id/tunnel` (cockpit) — returns `TunnelCoordinates` (relay coords + this host's tunnelPort) or 404 if not provisioned.
  - `POST /tunnel/cockpit-key` (cockpit) — body `{pubkey, label}`; store + rewrite authorized_keys; ack.
- Config/env: `RELAY_HOST` (SSH-reachable cowork address), `RELAY_SSH_PORT=22`, `RCWTUN_USER=rcwtun`, `RCWTUN_AUTHKEYS_PATH`.
- `apps/web/next.config.ts`: rewrites for `/tunnel/:path*` (and `/hosts/:id/tunnel` already under `/hosts`).

### 4. Agent (`apps/hook-cli`)
- Ensure ed25519 keypair at `~/.redstone/tunnel_ed25519` (generate via `ssh-keygen -t ed25519 -N "" -f ...` if absent; never throw).
- On startup (and re-announce): `POST /hosts/:id/tunnel {pubkey}` → store coordinates.
- New `tunnelLoop`: keep a persistent `ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=~/.redstone/relay_known_hosts -i <key> -R <tunnelPort>:localhost:22 -p <relayPort> rcwtun@<relayHost>` alive; auto-restart with capped backoff on exit. Only runs after successful provisioning. Fail-safe: errors never crash the agent.

### 5. Desktop (`apps/desktop/src/main`)
- Jump keypair in `userData` (e.g. `rcw_jump_ed25519`); on first relay need, `POST /tunnel/cockpit-key`.
- `getSshTarget(machine): { host: string; opts: string[] }` — replaces bare `getSshHost` at the call sites:
  1. Manual `ssh-hosts.json` override → direct (`{host, opts:[]}`), unchanged.
  2. Probe direct TCP `address:sshPort` with a short timeout (e.g. 2.5s). Reachable → `{host: user@address, opts:[]}`.
  3. Unreachable → fetch `GET /hosts/:id/tunnel`; return `{ host: user@address (identity for host-key/config), opts: ["-o", "ProxyCommand=ssh -i <jumpKey> -o StrictHostKeyChecking=accept-new -W localhost:<tunnelPort> -p <relayPort> rcwtun@<relayHost>"] }`.
  - End-to-end auth to the host is unchanged (the user's existing keys). Only transport differs.
- Thread `opts` through `terminal.ts`, `git.ts`, `forwarding.ts`, `workspace.ts` (all currently build ssh argv with `getSshHost` + `sshMuxOpts`). Cache probe results briefly to avoid re-probing on every op.

## Security notes
- `rcwtun` keys can **only** port-forward (agents: bind exactly their `permitlisten` port; cockpit: `-W` to relay loopback only). No shell, no arbitrary forwarding.
- Host authentication is never delegated to `rcwtun` — the cockpit still authenticates to the real host with the operator's own key end-to-end.
- Reverse ports never leave the relay loopback; nothing new is exposed to the internet.

## Rollout / verification
1. Backend + agent + desktop code (no deploy).
2. Host setup script creates `rcwtun` + bind mount; deploy API/Web.
3. Provision agents; confirm `authorized_keys` written and each agent's `-R` established (`ss -tlnp` on relay shows loopback ports).
4. Simulate a NAT'd host (block inbound / use a host with no open port); confirm terminal, git, and browser-forward work via relay; confirm directly-reachable hosts still go direct.
