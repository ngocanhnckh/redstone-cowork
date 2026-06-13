# M2 Slice 2 — Google (Gmail + Calendar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the CEO connect their Google account once (OAuth) so the virtual team ingests recent Gmail messages and Calendar events into the same unified event stream as Jira/Mattermost.

**Architecture:** Reuse the Slice 1 connector framework verbatim. A single `google` connector implements `Connector` (`validate`/`pull`), but the stored secret is an OAuth **refresh token**, not a PAT — the connector exchanges it for short-lived access tokens (`oauth2.googleapis.com/token`) using the instance's `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. A small in-app OAuth flow (API controller + two Next.js route handlers) runs the consent dance and then calls the existing `ConnectionsService.create` with the refresh token. Once a `google` connection exists, the existing worker `sync-due` loop picks it up automatically — no scheduler changes.

**Tech Stack:** NestJS (hexagonal), Next.js 15 route handlers, Zod v3, Vitest. Google OAuth 2.0 (offline access), Gmail API v1, Calendar API v3.

---

### Task 1: Add `google` to the connector kind enum

**Files:**
- Modify: `packages/shared/src/integrations/integrations.ts:3`

- [ ] **Step 1:** Change `ConnectorKindSchema = z.enum(["jira", "mattermost"])` → `z.enum(["jira", "mattermost", "google"])`.
- [ ] **Step 2:** Build shared: `pnpm --filter @rcw/shared build`. Commit.

---

### Task 2: GoogleConnector (TDD)

**Files:**
- Create: `apps/api/src/adapters/connectors/google.connector.ts`
- Test: `apps/api/test/google-connector.test.ts`

**Shape:** `new GoogleConnector({ clientId, clientSecret, fetchImpl? })`. `kind = "google"`. The connector treats `cfg.token` as the **refresh token** and `cfg.endpoint` as the API base (`https://www.googleapis.com`).

- [ ] **Step 1 — failing test:** mock fetch so the token endpoint returns `{ access_token: "at", expires_in: 3600 }`, the gmail list returns one id, the gmail get returns metadata headers (From/Subject/Date) + internalDate, and the calendar list returns one updated event. Assert:
  - `validate` POSTs to `https://oauth2.googleapis.com/token` with `grant_type=refresh_token` and returns `{ ok: true }`.
  - `pull` emits a `gmail.message` event (sourceId = message id, payload.subject/from/snippet) and a `gcal.event` event (sourceId = event id, payload.summary/start), and advances cursor (`lastInternalDate`, `eventsUpdatedMin`).
- [ ] **Step 2:** Run `pnpm --filter @rcw/api test google-connector` → FAIL.
- [ ] **Step 3 — implement:**
  - `private async accessToken(refreshToken)`: POST form-encoded `client_id/client_secret/refresh_token/grant_type=refresh_token` to `https://oauth2.googleapis.com/token`; throw on non-OK; return `access_token`.
  - `validate(cfg)`: try `accessToken(cfg.token)`; `{ ok:true }` or `{ ok:false, error }`.
  - `pull(cfg, cursor)`: get access token, run `pullGmail` + `pullCalendar`, merge events, return `{ events, cursor: { lastInternalDate, eventsUpdatedMin } }`.
  - `pullGmail`: `GET /gmail/v1/users/me/messages?maxResults=15&q=newer_than:7d` → for each id `GET /gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`; skip messages whose `internalDate` ≤ `cursor.lastInternalDate`; emit `gmail.message` `{ source:"google", sourceId:id, type:"gmail.message", occurredAt:new Date(Number(internalDate)), actor:from, payload:{subject,from,snippet}, links:[{rel:"self",href:`https://mail.google.com/mail/#all/${id}`}] }`; track max internalDate.
  - `pullCalendar`: `GET /calendar/v3/calendars/primary/events?singleEvents=true&orderBy=updated&maxResults=25` + `updatedMin` when cursor present; emit `gcal.event` `{ sourceId:id, occurredAt:new Date(updated), actor:organizer?.email, payload:{summary,start,end,status}, links:[{rel:"self",href:htmlLink}] }`; track max `updated`.
  - All Google API calls use `Authorization: Bearer <accessToken>`. A failing sub-pull (gmail OR calendar) should not nuke the other — wrap each in try/catch, keep prior cursor slice on failure.
- [ ] **Step 4:** Run test → PASS. Commit.

---

### Task 3: GoogleOAuthService (code exchange) — TDD

**Files:**
- Create: `apps/api/src/application/google-oauth.service.ts`
- Test: `apps/api/test/google-oauth.service.test.ts`

**Shape:** `new GoogleOAuthService({ clientId, clientSecret, redirectUri, fetchImpl? }, connectionsService)`.

- [ ] **Step 1 — failing test:** `buildAuthUrl("state123")` returns a URL containing `client_id`, `redirect_uri`, `response_type=code`, `access_type=offline`, `prompt=consent`, `scope` (gmail.readonly + calendar.readonly + userinfo.email + openid), `state=state123`. For `exchangeAndConnect(code)`: mock token endpoint → `{ refresh_token:"rt", access_token:"at", id_token:<jwt with email> }`; assert it calls `connections.create` with `{ kind:"google", endpoint:"https://www.googleapis.com", token:"rt", label:<email>, config:{ scopes } }` and returns the connection. (Inject a fake ConnectionsService with a spy `create`.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3 — implement:** `buildAuthUrl` assembles `https://accounts.google.com/o/oauth2/v2/auth?...`. `exchangeAndConnect`: POST code to token endpoint (grant_type=authorization_code, redirect_uri), decode email from `id_token` payload (base64url middle segment) or fall back to userinfo; throw if no `refresh_token` (means consent didn't grant offline — caller surfaces "re-consent"); call `connections.create`.
- [ ] **Step 4:** Run → PASS. Commit.

---

### Task 4: OAuth HTTP controller

**Files:**
- Create: `apps/api/src/adapters/http/oauth.controller.ts`
- Test: extend `apps/api/test/*` with a supertest case (auth required; `/oauth/google/url` returns a url)

- [ ] **Step 1:** Controller `@UseGuards(InstanceTokenGuard)`:
  - `GET /oauth/google/url` → `{ url: oauth.buildAuthUrl(randomUUID()) }`.
  - `POST /oauth/google/callback` `{ code }` → `oauth.exchangeAndConnect(code)`; map errors to `BadRequestException`.
- [ ] **Step 2:** supertest: `GET /oauth/google/url` without bearer → 401; with bearer → 200 + `url` startsWith `https://accounts.google.com`. (Provide GoogleOAuthService with dummy creds in the test module.) Commit.

---

### Task 5: Wire into composition root

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1:** In the `CONNECTORS` factory, append `new GoogleConnector({ clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" })`.
- [ ] **Step 2:** Provide `GoogleOAuthService` (useFactory reading `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE` → `redirectUri = ${base}/api/oauth/google/callback`, injecting `ConnectionsService`). Register `OAuthController` in `controllers`.
- [ ] **Step 3:** `pnpm --filter @rcw/api test` → all green. Commit.

---

### Task 6: Web OAuth route handlers + UI button

**Files:**
- Create: `apps/web/app/api/oauth/google/start/route.ts`
- Create: `apps/web/app/api/oauth/google/callback/route.ts`
- Modify: `apps/web/components/Connections.tsx`

- [ ] **Step 1 — start route:** `GET` → `apiFetch("/oauth/google/url")` → `302` redirect (`Response.redirect`) to the returned `url`. On error redirect `/?google=error`.
- [ ] **Step 2 — callback route:** `GET` reads `?code` → `apiFetch("/oauth/google/callback", { method:"POST", body: JSON.stringify({ code }) })` → on ok `302 /?google=connected`, else `/?google=error`. (apiFetch already injects the bearer from the `rcw_token` cookie — the user is logged in in this browser.)
- [ ] **Step 3 — UI:** in `Connections.tsx` add a "Connect Google (Gmail + Calendar)" button → `window.location.href = "/api/oauth/google/start"`. Show a small confirmation banner when `?google=connected`.
- [ ] **Step 4:** `pnpm --filter @rcw/web build` (typecheck). Commit.

---

### Task 7: Env + deploy + live verify

**Files:**
- Modify: `.env.example` (add `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=`, `OAUTH_REDIRECT_BASE=https://cowork.example.com`)
- Server `.env` (not committed): set the three values from `.creds`.

- [ ] **Step 1:** Add the three vars to `.env.example` (placeholders only). Commit + push.
- [ ] **Step 2:** Set the real values in the server `.env` via `deploy/remote.sh`, then `sync` + `build` + `up`.
- [ ] **Step 3 — live verify:** from the browser open `/api/oauth/google/start`, complete consent, land on `/?google=connected`; confirm a `google` connection appears in `GET /connections` with `status: connected`; trigger `POST /connections/:id/sync` and confirm `inserted > 0` and `gmail.message`/`gcal.event` rows show in `GET /events/recent`.
- [ ] **Step 4:** Update `docs/TECH-DEBT.md`, report Done to Jira (RCW-4) + Mattermost. Push.
