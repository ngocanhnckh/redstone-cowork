# Device Enrollment — one-line install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Generate a copy-paste one-liner from the hosted website that installs + configures the `redstone` host CLI on any server using a **per-device, revocable token**; the master `INSTANCE_TOKEN` never leaves the user's machines.

**Architecture:** Additive to `apps/api` (NestJS hexagonal). New **device-token** subsystem (shared schema → store port → in-memory + Postgres → service → controller). The existing `InstanceTokenGuard` is extended to also accept device tokens and to tag `req.authKind`; device management is master-token-only. Two **public** endpoints serve `install.sh` + a prebuilt single-file `redstone.js` bundle of `apps/hook-cli`. A **Devices** page on `apps/web` mints/lists/revokes and shows the one-liner.

**Tech Stack:** TypeScript, NestJS, Zod v3 (`@rcw/shared`), Vitest + supertest, Postgres (idempotent SQL migrations), esbuild (CLI bundle), Next.js (web).

## Global Constraints
- Node 22 (target hosts need Node ≥ 20). pnpm@10.12.1 workspace. API tests: `pnpm --filter @rcw/api exec vitest run`.
- Hexagonal: domain ports framework-free (Symbol tokens); adapters in `adapters/{http,persistence}`; composition root `app.module.ts` (Postgres when `DATABASE_URL` set, in-memory otherwise — tests in-memory).
- Device tokens: prefix `rcwd_`, stored **SHA-256 hashed**; plaintext returned **once** at mint.
- Conventional commits; end body with `Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R`.
- Never run Docker on the Mac; Postgres + Docker bundle serving verified via `deploy/remote.sh` on the dev server.

---

### Task 1: Shared device-token schemas

**Files:** Create `packages/shared/src/devices/device.ts`; modify `packages/shared/src/index.ts` (re-export the new module, matching how `sessions`/`decisions` are exported).

**Interfaces / Produces:**
```ts
DeviceSchema      // public view: { id, label, createdAt, lastSeenAt|null, revokedAt|null }
NewDeviceSchema   // { label }
MintedDeviceSchema// DeviceSchema fields + { token: string }   (returned once at mint)
types Device, NewDevice, MintedDevice
```

- [ ] **Step 1: Write `device.ts`**
```ts
import { z } from "zod";

export const DeviceSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  createdAt: z.coerce.date(),
  lastSeenAt: z.coerce.date().nullable().default(null),
  revokedAt: z.coerce.date().nullable().default(null),
});
export type Device = z.infer<typeof DeviceSchema>;

export const NewDeviceSchema = z.object({ label: z.string().min(1).max(60) });
export type NewDevice = z.infer<typeof NewDeviceSchema>;

export const MintedDeviceSchema = DeviceSchema.extend({ token: z.string().min(1) });
export type MintedDevice = z.infer<typeof MintedDeviceSchema>;
```
- [ ] **Step 2: Re-export** from `packages/shared/src/index.ts` (add `export * from "./devices/device";` next to the other module exports — check the file to match its style).
- [ ] **Step 3: Build shared** `pnpm --filter @rcw/shared build` (exit 0).
- [ ] **Step 4: Commit** `feat(shared): device-token schemas`.

---

### Task 2: DeviceTokenStore port + in-memory store + DevicesService

**Files:** Create `apps/api/src/domain/devices/device-token-store.port.ts`, `apps/api/src/adapters/persistence/in-memory-device-token-store.ts`, `apps/api/src/application/devices.service.ts`, `apps/api/test/devices.service.test.ts`.

**Interfaces:**
```ts
// DeviceRecord = persisted shape (includes the secret hash; never leaves the store layer)
type DeviceRecord = { id: string; tokenHash: string; label: string; createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null };
interface DeviceTokenStore {
  create(rec: DeviceRecord): Promise<DeviceRecord>;
  listActive(): Promise<DeviceRecord[]>;               // revokedAt === null, newest first
  findByHash(tokenHash: string): Promise<DeviceRecord | null>;
  touch(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<boolean>;      // false = unknown/already revoked
}
const DEVICE_TOKEN_STORE = Symbol("DeviceTokenStore");
// DevicesService:
mint(label: string): Promise<MintedDevice>           // generates rcwd_<24 bytes b64url>, stores sha256, returns plaintext ONCE
list(): Promise<Device[]>                            // public view (no hash/token)
revoke(id: string): Promise<boolean>
verify(token: string): Promise<{ id: string } | null> // hash→findByHash→null if missing/revoked; touch lastSeen
```

- [ ] **Step 1: Failing test `devices.service.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { DevicesService } from "../src/application/devices.service";
import { InMemoryDeviceTokenStore } from "../src/adapters/persistence/in-memory-device-token-store";

const svc = () => new DevicesService(new InMemoryDeviceTokenStore());

describe("DevicesService", () => {
  it("mint returns a plaintext rcwd_ token once and stores only the hash", async () => {
    const s = svc();
    const m = await s.mint("prod-server");
    expect(m.token).toMatch(/^rcwd_/);
    expect(m.label).toBe("prod-server");
    const list = await s.list();
    expect(list[0].id).toBe(m.id);
    expect((list[0] as Record<string, unknown>).token).toBeUndefined();
    expect((list[0] as Record<string, unknown>).tokenHash).toBeUndefined();
  });
  it("verify accepts a valid token (and touches lastSeen), rejects unknown + revoked", async () => {
    const s = svc();
    const m = await s.mint("dev");
    expect(await s.verify(m.token)).toEqual({ id: m.id });
    expect(await s.verify("rcwd_nope")).toBeNull();
    await s.revoke(m.id);
    expect(await s.verify(m.token)).toBeNull();
    expect((await s.list()).length).toBe(0); // revoked drops out of active list
  });
});
```
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @rcw/api exec vitest run test/devices.service.test.ts`
- [ ] **Step 3: Port** `device-token-store.port.ts` — the interface + `DeviceRecord` type + `DEVICE_TOKEN_STORE` symbol above.
- [ ] **Step 4: In-memory store** `in-memory-device-token-store.ts` — a `Map<id, DeviceRecord>`; `listActive` filters `revokedAt===null` sorted by `createdAt` desc; `findByHash` scans values; `touch`/`revoke` mutate.
- [ ] **Step 5: `devices.service.ts`**
```ts
import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Device, MintedDevice } from "@rcw/shared";
import { DEVICE_TOKEN_STORE, type DeviceRecord, type DeviceTokenStore } from "../domain/devices/device-token-store.port";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const toPublic = (r: DeviceRecord): Device => ({ id: r.id, label: r.label, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, revokedAt: r.revokedAt });

@Injectable()
export class DevicesService {
  constructor(@Inject(DEVICE_TOKEN_STORE) private readonly store: DeviceTokenStore) {}
  async mint(label: string): Promise<MintedDevice> {
    const token = "rcwd_" + randomBytes(24).toString("base64url");
    const rec = await this.store.create({ id: randomUUID(), tokenHash: sha256(token), label, createdAt: new Date(), lastSeenAt: null, revokedAt: null });
    return { ...toPublic(rec), token };
  }
  async list(): Promise<Device[]> { return (await this.store.listActive()).map(toPublic); }
  revoke(id: string): Promise<boolean> { return this.store.revoke(id, new Date()); }
  async verify(token: string): Promise<{ id: string } | null> {
    if (!token.startsWith("rcwd_")) return null;
    const rec = await this.store.findByHash(sha256(token));
    if (!rec || rec.revokedAt) return null;
    await this.store.touch(rec.id, new Date());
    return { id: rec.id };
  }
}
```
- [ ] **Step 6: Run → PASS.** Then full suite (`vitest run`) — still green (vitest doesn't typecheck; the Postgres store gap from Task 3 won't fail tests).
- [ ] **Step 7: Commit** `feat(api): device-token store + DevicesService (hashed, revocable)`.

---

### Task 3: Postgres device-token store + migration

**Files:** Create `apps/api/migrations/008_devices.sql`, `apps/api/src/adapters/persistence/postgres-device-token-store.ts`.

> No unit test (suite is in-memory). Verify = `tsc --noEmit` green after Task 4 wires it + deploy smoke.

- [ ] **Step 1: Migration `008_devices.sql`**
```sql
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS devices_token_hash_idx ON devices (token_hash);
```
- [ ] **Step 2: `postgres-device-token-store.ts`** — implement `DeviceTokenStore` against `this.pool` (read an existing postgres store, e.g. `postgres-session-store.ts`, to match the pool-injection + row-mapper convention). Map snake_case → `DeviceRecord` (`token_hash`→`tokenHash`, `last_seen_at`→`lastSeenAt`, `revoked_at`→`revokedAt`). `listActive`: `WHERE revoked_at IS NULL ORDER BY created_at DESC`. `findByHash`: `WHERE token_hash=$1`. `touch`: `UPDATE devices SET last_seen_at=$2 WHERE id=$1`. `revoke`: `UPDATE devices SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL` → `rowCount>0`.
- [ ] **Step 3: Commit** `feat(api): Postgres device-token store + migration` (typecheck deferred to Task 4 wiring).

---

### Task 4: Auth guard extension + DevicesController + wiring (e2e)

**Files:** Modify `apps/api/src/adapters/http/instance-token.guard.ts`; create `apps/api/src/adapters/http/master-token.guard.ts`, `apps/api/src/adapters/http/devices.controller.ts`; modify `apps/api/src/app.module.ts`; create `apps/api/test/devices.e2e.test.ts`.

**Interfaces:**
- `InstanceTokenGuard.canActivate` becomes async: accepts the master `INSTANCE_TOKEN` (sets `req.authKind="instance"`) OR a valid device token via `DevicesService.verify` (sets `req.authKind="device"`); else 401.
- `MasterTokenGuard`: throws 403 unless `req.authKind === "instance"`.
- `DevicesController` `@Controller("devices")` `@UseGuards(InstanceTokenGuard, MasterTokenGuard)`: `POST /` mint `{label}` → MintedDevice; `GET /` → Device[]; `DELETE /:id` → `{revoked:boolean}`.

- [ ] **Step 1: Failing e2e `devices.e2e.test.ts`** (mirror the bootstrap of `apps/api/test/sessions.e2e.test.ts` — set `process.env.INSTANCE_TOKEN`, `Test.createTestingModule({imports:[AppModule]})`). Assert:
  - `POST /devices` with master token → 201, body has `token` starting `rcwd_`.
  - `GET /devices` with master token → 200 array containing the device (no `token`/`tokenHash`).
  - The minted device **token works on a normal endpoint**: `GET /sessions` with `Authorization: Bearer <minted token>` → 200.
  - The minted device token is **forbidden on management**: `GET /devices` with the device token → 403.
  - `DELETE /devices/:id` (master) → 200; afterwards the device token on `/sessions` → 401.
  - A random bad token on `/sessions` → 401.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extend `instance-token.guard.ts`**
```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "../../infrastructure/config";
import { DevicesService } from "../../application/devices.service";

@Injectable()
export class InstanceTokenGuard implements CanActivate {
  constructor(private readonly devices: DevicesService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; authKind?: string }>();
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException();
    if (token === loadConfig().INSTANCE_TOKEN) { req.authKind = "instance"; return true; }
    const dev = await this.devices.verify(token);
    if (dev) { req.authKind = "device"; return true; }
    throw new UnauthorizedException();
  }
}
```
- [ ] **Step 4: `master-token.guard.ts`**
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
@Injectable()
export class MasterTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ authKind?: string }>();
    if (req.authKind !== "instance") throw new ForbiddenException("master token required");
    return true;
  }
}
```
- [ ] **Step 5: `devices.controller.ts`**
```ts
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { NewDeviceSchema } from "@rcw/shared";
import { ZodError } from "zod";
import { DevicesService } from "../../application/devices.service";
import { InstanceTokenGuard } from "./instance-token.guard";
import { MasterTokenGuard } from "./master-token.guard";

@Controller("devices")
@UseGuards(InstanceTokenGuard, MasterTokenGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}
  @Post()
  async mint(@Body() body: unknown) {
    try { const { label } = NewDeviceSchema.parse(body); return await this.devices.mint(label); }
    catch (e) { if (e instanceof ZodError) throw new BadRequestException(e.issues); throw e; }
  }
  @Get() list() { return this.devices.list(); }
  @Delete(":id") async revoke(@Param("id") id: string) { return { revoked: await this.devices.revoke(id) }; }
}
```
- [ ] **Step 6: Wire `app.module.ts`** — provide `DevicesService`; provide `DEVICE_TOKEN_STORE` via factory `inject:[PG_POOL]` (`pool ? new PostgresDeviceTokenStore(pool) : new InMemoryDeviceTokenStore()`); register `DevicesController` in `controllers`. (InstanceTokenGuard now has a constructor dep — Nest resolves it since DevicesService is a provider.) Imports added accordingly.
- [ ] **Step 7: Run e2e + full suite → green; `tsc --noEmit` exit 0** (Postgres store from Task 3 now satisfies the interface).
- [ ] **Step 8: Commit** `feat(api): accept device tokens in auth + master-only /devices endpoints`.

---

### Task 5: CLI bundle + public install endpoints

**Files:** Modify `apps/hook-cli/package.json` (add esbuild + `build:bundle`); create `apps/hook-cli/build-bundle.mjs`; create `apps/api/src/adapters/http/install.controller.ts`; modify `apps/api/src/app.module.ts` (register controller, no guard); modify `apps/api/Dockerfile` (build + copy the bundle); create `apps/api/test/install.e2e.test.ts`.

**Interfaces:** `GET /install.sh` (public) → `text/plain` shell script that reads `--server`/`--token`, checks Node ≥ 20, downloads `"$SERVER/install/redstone.js"`, installs a `~/.local/bin/redstone` launcher, runs `redstone init`, prints next steps. `GET /install/redstone.js` (public) → `application/javascript`, the bundled CLI (from `process.env.REDSTONE_BUNDLE_PATH ?? <resolved default>`; 503 if absent).

- [ ] **Step 1: esbuild bundle.** Add to `apps/hook-cli` devDeps `"esbuild": "^0.24.0"` and script `"build:bundle": "node build-bundle.mjs"`. `build-bundle.mjs`:
```js
import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"], bundle: true, platform: "node", target: "node20",
  format: "cjs", outfile: "dist/redstone.bundle.js", banner: { js: "#!/usr/bin/env node" },
});
console.log("bundled -> dist/redstone.bundle.js");
```
Run `pnpm --filter @rcw/hook-cli build:bundle` locally → confirm `apps/hook-cli/dist/redstone.bundle.js` exists and `node apps/hook-cli/dist/redstone.bundle.js status` prints config JSON.
- [ ] **Step 2: Failing e2e `install.e2e.test.ts`** — set `process.env.REDSTONE_BUNDLE_PATH` to a temp file containing `"console.log('x')"`; `GET /install.sh` → 200, `content-type` text/plain, body contains `redstone init` and `/install/redstone.js`; `GET /install/redstone.js` → 200, `content-type` application/javascript, body contains `console.log('x')`. Both WITHOUT an Authorization header (public).
- [ ] **Step 3: `install.controller.ts`** (`@Controller()`, NO guard):
```ts
import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const bundlePath = () => process.env.REDSTONE_BUNDLE_PATH ?? join(process.cwd(), "redstone.bundle.js");

@Controller()
export class InstallController {
  @Get("install.sh")
  @Header("Content-Type", "text/plain; charset=utf-8")
  installScript(): string { return INSTALL_SH; }

  @Get("install/redstone.js")
  bundle(@Res() res: Response) {
    const p = bundlePath();
    if (!existsSync(p)) return res.status(503).send("bundle unavailable");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    return res.send(readFileSync(p, "utf8"));
  }
}

const INSTALL_SH = `#!/usr/bin/env bash
set -euo pipefail
SERVER=""; TOKEN=""
while [ $# -gt 0 ]; do case "$1" in
  --server) SERVER="$2"; shift 2;;
  --token) TOKEN="$2"; shift 2;;
  *) echo "unknown arg: $1" >&2; exit 1;; esac; done
[ -n "$SERVER" ] && [ -n "$TOKEN" ] || { echo "usage: install.sh --server <url> --token <token>" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required (>= 20). Install it then re-run." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node >= 20 required (found $(node -v))." >&2; exit 1; }
mkdir -p "$HOME/.redstone" "$HOME/.local/bin"
echo "Downloading redstone..."
curl -fsSL "$SERVER/install/redstone.js" -o "$HOME/.redstone/redstone.js"
cat > "$HOME/.local/bin/redstone" <<EOF
#!/bin/sh
exec node "$HOME/.redstone/redstone.js" "\\$@"
EOF
chmod +x "$HOME/.local/bin/redstone"
"$HOME/.local/bin/redstone" init --server "$SERVER" --token "$TOKEN"
echo ""
echo "✓ redstone installed. If 'redstone' isn't found, add to your shell: export PATH=\\"\\$HOME/.local/bin:\\$PATH\\""
echo "Next: cd <your project> && redstone hook && claude --resume"
`;
```
(Keep the heredoc/escaping exactly; the `\\$@` and `\\"` are escapes so the emitted script has literal `$@` and quotes.)
- [ ] **Step 4: Register** `InstallController` in `app.module.ts` `controllers` (no guard — it's public like `HealthController`).
- [ ] **Step 5: Run e2e + full suite green; tsc exit 0.**
- [ ] **Step 6: Dockerfile** — in the build stage, also `COPY apps/hook-cli apps/hook-cli`, `RUN pnpm install --frozen-lockfile --filter @rcw/hook-cli...` (or within the existing install) and `RUN pnpm --filter @rcw/hook-cli build:bundle`; in the final stage `COPY --from=build /repo/apps/hook-cli/dist/redstone.bundle.js /app/redstone.bundle.js` and set `ENV REDSTONE_BUNDLE_PATH=/app/redstone.bundle.js`. Keep edits minimal + ordered so layer caching still works. (Read the current Dockerfile and weave these in.)
- [ ] **Step 7: Commit** `feat(api,hook-cli): public install.sh + bundled redstone.js`.

---

### Task 6: Web Devices page

**Files:** Create `apps/web/components/Devices.tsx`; modify `apps/web/app/page.tsx` (render `<Devices/>`); modify `apps/web/app/api/proxy/[...path]/route.ts` (allowlist `devices`).

- [ ] **Step 1: Proxy allowlist** — add to the `ALLOWED` array in the proxy route: `/^devices$/` and `/^devices\/[\w-]+$/`.
- [ ] **Step 2: `Devices.tsx`** (client component, same fetch/style pattern as `Connections.tsx`): a name input + **Generate** button → `POST /api/proxy/devices {label}` → on success show the one-liner in a `<code>`/`<pre>` block:
  `curl -fsSL <ORIGIN>/install.sh | bash -s -- --server <ORIGIN> --token <token>` (compute `<ORIGIN>` from `window.location.origin`) with a **Copy** button and a one-time "copy it now — it won't be shown again" warning. Below, a list from `GET /api/proxy/devices` (label · last-seen · **Revoke** → `DELETE /api/proxy/devices/:id`). Liquid-glass-consistent inline styles like the rest of the web app.
- [ ] **Step 3: Render** `<Devices/>` in `apps/web/app/page.tsx` (import + place near `<Connections/>`).
- [ ] **Step 4: Build web** `pnpm --filter @rcw/web build` (or typecheck) → no errors.
- [ ] **Step 5: Commit** `feat(web): Devices page — generate one-line install + revoke`.

---

### Task 7: Deploy + live verify + report

- [ ] **Step 1:** Full local gates: `pnpm --filter @rcw/shared build && pnpm --filter @rcw/api exec tsc --noEmit && pnpm --filter @rcw/api exec vitest run` — all green.
- [ ] **Step 2: Deploy** `DEV_SERVER=youruser@your-server.example.com DEV_DIR=/home/youruser/redstone-cowork ./deploy/remote.sh up` (rebuilds the API image so the bundle is baked + migration 008 applies).
- [ ] **Step 3: Live verify (on the dev server / through the tunnel):**
  - `GET /install.sh` (public) returns the script; `GET /install/redstone.js` returns JS.
  - Mint a device via the master token: `curl -XPOST .../devices -H "Authorization: Bearer $INSTANCE_TOKEN" -d '{"label":"smoke"}'` → returns `rcwd_…`.
  - That token works: `curl .../sessions -H "Authorization: Bearer rcwd_…"` → 200; and is 403 on `.../devices`.
  - Run the actual one-liner in a scratch dir on the dev server (Node present) → it installs `~/.local/bin/redstone` + writes `~/.redstone/config.json`; `redstone status` shows the config. Revoke the smoke device afterward.
- [ ] **Step 4:** Report to Mattermost; push; (optional) update memory.

## Spec coverage (self-review)
- Per-device revocable tokens (hashed) → Tasks 1–4. ✓
- Guard accepts master OR device token; `/devices` master-only → Task 4. ✓
- Public `install.sh` + prebuilt bundle served by the instance → Task 5. ✓
- Website generates/lists/revokes + shows the one-liner → Task 6. ✓
- Node-≥20 check, idempotent install, next-steps print → Task 5 (install.sh). ✓
- Out of scope (YAGNI, per spec): Node bootstrap, per-device scopes, standalone binaries, auto `redstone hook`.
