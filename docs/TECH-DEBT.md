# Tech Debt Log

Items found in milestone-close reviews, to be addressed in the noted milestone. Remove entries when fixed.

## Logged at M0 close (2026-06-07)

| Priority | Item | Target |
|---|---|---|
| P1 | Replace `===` token comparison with `crypto.timingSafeEqual` in `InstanceTokenGuard` | M1 |
| P1 | Add `onModuleDestroy` pool cleanup for `PostgresEventStore` (graceful pg shutdown) | M1 |
| P2 | Call `migrate()` from `bootstrap()` instead of shell `&&` so migration failure always crashes visibly | M1 |
| P2 | Add fetch timeouts (`AbortSignal.timeout`) in `apps/web/app/page.tsx` `getStatus()` | M1 |
| P2 | Add worker healthcheck / liveness probe (hung worker is never restarted) | M1 |
| P3 | Inject config at construction in `InstanceTokenGuard` (currently Zod-parses env per request) | M1+ |
| P3 | Remove unused `uuid` dependency from `apps/api/package.json` (uses `node:crypto`) | M1+ |
| P3 | Move hardcoded dev-server address out of `deploy/remote.sh` (use env/SSH config default) | M1+ |
| P3 | Qdrant healthcheck → `curl -sf localhost:6333/readyz` instead of bash `/dev/tcp` | M2 |
