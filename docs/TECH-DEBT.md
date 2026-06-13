# Tech Debt Log

Items found in milestone-close reviews, to be addressed in the noted milestone. Remove entries when fixed.

## Logged at M0 close (2026-06-07)

| Priority | Item | Target |
|---|---|---|
| P1 | Replace `===` token comparison with `crypto.timingSafeEqual` in `InstanceTokenGuard` | M1b |
| ~~P1~~ | ~~Pool cleanup~~ — **fixed in M1a** (shared `PG_POOL` provider + `PoolShutdown.onModuleDestroy`) | done |
| P2 | Call `migrate()` from `bootstrap()` instead of shell `&&` so migration failure always crashes visibly | M1b |
| ~~P2~~ | ~~Fetch timeouts in page.tsx getStatus()~~ — **obsolete** (page replaced by client UI + proxy in M1a) | done |
| P2 | Add worker healthcheck / liveness probe (hung worker is never restarted) | M1 |
| P3 | Inject config at construction in `InstanceTokenGuard` (currently Zod-parses env per request) | M1+ |
| P3 | Remove unused `uuid` dependency from `apps/api/package.json` (uses `node:crypto`) | M1+ |
| P3 | Move hardcoded dev-server address out of `deploy/remote.sh` (use env/SSH config default) | M1+ |
| P3 | Qdrant healthcheck → `curl -sf localhost:6333/readyz` instead of bash `/dev/tcp` | M2 |

## Logged at M2 Slice 2 (2026-06-13)

| Priority | Item | Target |
|---|---|---|
| P2 | `GoogleConnector` swallows per-source pull errors silently (gmail/calendar try/catch with empty body) — record the failure on the connection (`lastError`) so a broken source is visible, not silent | M2 Slice 3 |
| P2 | Push sender also swallows send failures silently (no logs) — add prune/error logging + a "Send test notification" button | M2 Slice 3 |
| P3 | Calendar pull is `orderBy=updated` ascending, 25/sync — back-catalogue accounts catch up to "now" only after many syncs; consider seeding `updatedMin` to recent on first connect | M2+ |
| P3 | OAuth `state` is generated but not verified on callback (flow is already behind the instance bearer, so low risk) — persist + check state for defense-in-depth | M2+ |
| P3 | Gmail pull fetches each message individually (1 list + N metadata GETs) — batch or use `history.list` for incremental | M2+ |

## Logged at M1a (2026-06-07)

| Priority | Item | Target |
|---|---|---|
| P2 | Atomic delivery claim (`UPDATE … WHERE delivered_at IS NULL RETURNING`) to close concurrent-poller double-send window | M1b |
| P2 | Keymap: free-text/custom replies to dialog questions (currently instruction-only); arrow-key dialogs if digit-select fails live | M1b |
| P3 | SSE `event:` field for EventSource ergonomics; EventsBus complete() on shutdown | M2 |
| P3 | Session cleanup/archival (test sessions linger as `lost`); DELETE endpoint | M2 |
