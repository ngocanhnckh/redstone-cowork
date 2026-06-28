# Passwordless SSH Onboarding — Design

**Date:** 2026-06-28  **Status:** Approved (CEO)

## Goal
One-click "Set up SSH" for a session's host: generate a local keypair if needed, have the
**redstone agent** (already running on the remote via the cowork relay) append the user's
public key to the remote `~/.ssh/authorized_keys` — **no password** — then auto-write a
managed `Host <alias>` block into the user's local `~/.ssh/config`. After that the Terminal
and `ssh -L` port forwards work with key auth.

## Why the agent can do this passwordlessly
The host CLI runs ON the remote and is already trusted via the relay (instance/device token).
So it can install the desktop's public key locally and report the box's ssh user/address —
bootstrapping key auth without ever handling a password. Requires a live wrapped
`redstone claude` session (its poller performs the action).

## Contract

### Shared (`packages/shared`)
- New decision kind `"ssh-authorize"` — deliverable, created **resolved** (like `mode`/`instruction`
  so it never shows as a pending card). Body: `{ publicKey: string }`. Add to DELIVERABLE_KINDS.

### Server (`apps/api`)
- `POST /sessions/:id/ssh-authorize { publicKey }` → create a resolved deliverable decision
  kind `ssh-authorize`, notify delivery waiters. → `{ ok: true }`.
- `POST /sessions/:id/ssh-result { ok, user?, address?, port?, error? }` → store latest result in
  an in-memory map keyed by sessionId (transient; single API instance), emit `session.updated`.
- `GET /sessions/:id/ssh-result` → latest result or `null`.

### Agent (`apps/hook-cli` poller)
When a delivery of kind `ssh-authorize` arrives, the poller does NOT tmux-type it. Instead:
1. `mkdir -p ~/.ssh` (700); append `publicKey` to `~/.ssh/authorized_keys` (600) if not already
   present (exact-line dedup).
2. Gather `user = os.userInfo().username`, `port = 22`, `address` best-effort
   (`curl -fsS https://api.ipify.org` with a short timeout; null on failure).
3. `POST /sessions/:id/ssh-result { ok:true, user, address, port }` (or `ok:false, error`).
4. Mark the delivery delivered.
Never breaks the session; all errors → `ok:false`.

### Desktop (`apps/desktop`)
- `main/ssh-setup.ts`: `ensureKeypair()` (generate `~/.ssh/id_ed25519` via `ssh-keygen -t ed25519
  -N "" -C redstone@<host>` if absent), `readPublicKey()`, `writeSshConfigBlock(alias, {hostName,
  user, port})` — idempotent block between `# >>> redstone <alias>` / `# <<< redstone <alias>`
  markers (never clobbers hand-written entries), with `IdentityFile ~/.ssh/id_ed25519`.
- Flow (`sshSetup(sessionId, machine)` over IPC, calling the cowork server through the existing
  authed api client):
  1. ensure keypair, read pubkey.
  2. `POST /sessions/:id/ssh-authorize { publicKey }`.
  3. poll `GET /sessions/:id/ssh-result` (~30s timeout).
  4. on result: alias = machine; if `address` present, write the ssh-config block + `setSshHost`;
     if absent, prompt the user for HostName, then write. Test `ssh -o BatchMode=yes
     -o ConnectTimeout=8 <alias> true` and report.
- UI: a "Set up SSH" affordance in ConnectionBar/Terminal when the host isn't reachable, with
  status (generating key / authorizing via agent / writing config / testing / done|error).

## Constraints / notes
- Requires a live wrapped `redstone claude` session (poller running). Document this.
- Address detection is best-effort (NAT); the user can edit HostName.
- Backend lands first (deploy + `redstone update` on hosts); desktop second.
