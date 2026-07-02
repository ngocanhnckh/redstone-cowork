# Session Inventory, External API & Redstone Remote-Back — Design

**Status:** approved (2026-07-02)

**Goal:** See *every* Claude Code session on a host — cowork-launched or not — grouped
by folder, with history and user tags; expose that (plus limited control) over an
external API authenticated by dedicated access keys or a Redstone token, so external
servers and a linked Redstone agent can read session context and drive sessions.

**Three subsystems, built in order:** ① Session Inventory → ② External API + access
keys → ③ Redstone remote-back.

---

## Background & the load-bearing constraint

Claude Code stores every session as `~/.claude/projects/<folder-slug>/<session-id>.jsonl`
**on each host machine** (the folder slug is the cwd with `/`→`-`; it is lossy because
real paths contain `-`, so cwd is recovered by reading a transcript line that carries
`cwd`, not by un-slugging). The cowork **server** has no access to those files, and
non-cowork sessions fire none of cowork's hooks. Therefore discovering "all sessions,
no matter what" **requires a host-side component** that scans and reports up.

**Approach chosen: a persistent per-host agent** (`redstone agent`). Rejected: on-demand
`redstone scan` (inventory goes stale; can't reach an idle host) and hooks-only
(structurally blind to non-cowork sessions). Interactive control of live sessions keeps
using the existing per-session poller, unchanged.

### Control model (from requirements)

- **Live cowork sessions** (running under the wrapper: tmux + poller + hooks): full
  interactive control — send input, interrupt, switch mode. **Unchanged.**
- **Discovered / non-cowork sessions**: read history, tag, and **passive one-shot**
  execution only — `claude --resume <id> -p "<message>" --permission-mode bypassPermissions`
  run headless in the session's cwd (no interactive questions), returning the reply.

---

## ① Session Inventory

### Host agent — `redstone agent` (new long-running command in `apps/hook-cli`)

One per host. Launched once (docs: run under launchd on macOS / systemd on Linux, or in a
tmux window). Fully defensive: any scan/exec error is caught and logged; the loops never die.

1. **Register:** `POST /hosts` `{ machine, hostId, user, os }` → host record. `hostId` is a
   stable per-machine UUID persisted at `~/.redstone/host-id`.
2. **Scan loop (~60s):** enumerate `~/.claude/projects/*/*.jsonl`. Per file collect, cheaply:
   - `id` = filename (minus `.jsonl`)
   - `cwd` = first transcript line carrying a `cwd` field (fallback: none → skip cwd)
   - `folder` = basename(cwd)
   - `title` = first user prompt text (head of file), truncated
   - `lastActive` = file mtime
   - `messageCount` = line count (or size-based estimate for very large files)
   - `sizeBytes`
   Report a snapshot: `POST /hosts/:hostId/inventory` `{ sessions: [...] }`. Server upserts.
3. **Command loop (long-poll ~25s):** `GET /hosts/:hostId/commands` returns queued commands:
   - `passive_run { sessionId, cwd, message }` → run the headless one-shot in `cwd`, capture
     stdout, `POST /hosts/:hostId/commands/:cmdId/result { ok, reply, error }`.
   - `fetch_history { sessionId, path }` → read the transcript tail (reuse the existing
     `readRecentMessages`) → post it back as the result.
   Every command is acked even on failure so one bad command can't wedge the queue
   (same invariant as the delivery poller).

### Cowork server — data model

Hexagonal, mirroring existing stores (in-memory + Postgres; migrations `NNN_*.sql`).

- `hosts` — `id (hostId)`, `machine`, `user`, `os`, `last_seen_at`, `created_at`.
- `discovered_sessions` — `id (session id)`, `host_id`, `cwd`, `folder`, `title`,
  `last_active`, `message_count`, `size_bytes`, `source` (`cowork` | `external`),
  `tags jsonb`, `created_at`, `updated_at`. Kept **separate** from live `sessions` to avoid
  polluting the hook-driven model; cross-referenced by session id where a live session exists.
  `source` = `cowork` when a matching live `sessions` row exists (or a cowork marker is present),
  else `external`.
- `host_commands` — `id`, `host_id`, `kind`, `payload jsonb`, `status` (`pending`|`done`),
  `result jsonb`, timestamps. Long-poll waiters mirror `DeliveryWaiters`.

### Cowork server — endpoints (guarded)

- `POST /hosts`, `POST /hosts/:id/inventory`, `GET /hosts/:id/commands` (long-poll),
  `POST /hosts/:id/commands/:cmdId/result` — the host-agent surface.
- `GET /inventory` — all discovered sessions; group/filter by `host`, `folder`, `tag`,
  `source`. Returns folder-grouped structure.
- `GET /inventory/:id/history` — enqueues a `fetch_history` command, waits for the result,
  returns the transcript tail (short cache).
- `POST /inventory/:id/tags`, `POST /inventory/:id/tags/remove` — mirror live-session tags
  (case-insensitive dedupe, ≤40 chars).
- `POST /inventory/:id/run` `{ message }` — enqueues `passive_run`, waits, returns the reply.
  Requires `control` scope when called with an access key.

### UI (web + desktop)

New **"All Sessions"** view: collapsible tree **Host → Folder → sessions**. Each session row:
tags (chips + add, reusing `TagBar`), last-active, message count, source badge. Actions:
**View history** (transcript viewer), **Send one-shot message** (for non-live), and for a
live cowork session a deep-link into the existing cockpit. Filters: folder, tag, source, host.

---

## ② External API + access keys

- `access_keys` table — `id`, `name`, `key_hash` (sha-256), `prefix` (first 8 chars, for
  display), `scope` (`read` | `control`), `created_at`, `last_used_at`, `revoked_at`.
- Guard gains an **`accesskey`** authKind: hash the presented bearer, look it up, reject if
  revoked; stamp `last_used_at`. Order in the guard: instance → device → accesskey → redstone.
- Admin endpoints (instance or owner-redstone auth): `POST /access-keys` `{ name, scope }`
  → returns the plaintext key **once**; `GET /access-keys` → metadata only (never the secret);
  `POST /access-keys/:id/revoke`.
- The inventory + `/run` endpoints accept an access key. `/run` requires `control` scope; all
  reads require `read` (a `control` key also reads).
- **Not** valid for the human cockpit surfaces (sessions/decisions/llm) in v1 — access keys are
  scoped to the external inventory/control API. (Broader scoping can come later.)

## ③ Redstone remote-back

Two ways to call this installation, both through the guard:
1. **Access key** (②).
2. **Redstone token** — the existing `redstone` authKind introspects it. **Security add:** at
   first org login, persist the owner's Redstone `sub` (`redstone_owner_sub`, an instance
   setting). The `redstone` authKind then authorizes **only** tokens whose introspected `sub`
   equals the owner — so not *any* Redstone user can reach your box, only the linked owner (the
   Redstone agent acting as that user).
- **Optional registration:** on org login, cowork may announce its public base URL + a freshly
  minted `control`-scope access key to Redstone so the agent knows where to reach back. Deferred
  and documented if Redstone exposes no registration endpoint; the token path (2) works regardless.

## Security & failure modes

- Access keys stored **hashed**, shown once, revocable; `last_used_at` tracked.
- `passive_run` always headless (`-p` + `bypassPermissions`) — never opens an interactive
  prompt; gated to `control` scope.
- Host agent loops are defensive; a failed scan/command never crashes the daemon and every
  command is acked.
- Redstone remote-back limited to the owner `sub`.
- Host-agent endpoints are authenticated (the agent holds the instance token or a dedicated
  key at install time, same as the existing CLI).

## Testing

- Host agent: unit-test the scanner (metadata extraction, cwd recovery, title/last-active) and
  the command executor (arg construction, result posting) with a temp `~/.claude/projects`.
- Server: store + service unit tests (inventory upsert, tags, command queue/long-poll), guard
  tests for the `accesskey` kind and owner-`sub` restriction, e2e for the endpoints.
- UI: rendered grouping + tag/run actions.

## Out of scope (v1)

- Interactive control of non-cowork sessions (passive one-shot only).
- Per-endpoint access-key scoping beyond read/control.
- Uploading full transcripts to the server (history is fetched on demand and cached briefly).
