# Enterprise Accounts — Redstone Cowork as company access tool

> Pivot: Redstone Cowork becomes a private multi-tenant tool: employees install the
> desktop app, sign in to the shared cowork server with their own account, and get
> per-account sessions on company/own servers. Admin (anh.nguyen) oversees everything.

**Delivery is sliced; each slice ships e2e-tested on the dev server.**

## Slice 1 — Accounts & auth core (THIS PLAN)

**Goal:** real accounts (admin/member) with password login and bearer tokens; every
session owned by an account; all existing sessions claimed by the admin account.

- `accounts` table: id, username (unique), display_name, role (`admin`|`member`),
  password_hash (scrypt, node:crypto — no new deps), disabled_at, created_at.
- `account_tokens` table: token_hash (sha256), account_id, label, created_at,
  last_used_at, revoked_at. Bearer token `rcwa_<48 hex>` returned once at login.
- `sessions.account_id` column (nullable text FK) + backfill-to-admin on seed.
- Domain port `AccountStore`; in-memory + Postgres adapters (same pattern as
  access-keys). AccountsService: seedAdmin (from ADMIN_USERNAME/ADMIN_PASSWORD env,
  first boot only), login, verify, create/list/disable accounts, claimUnowned.
- Guard: account bearer accepted → `authKind: "account"`, `req.account` attached.
  INSTANCE_TOKEN keeps working (maps to admin-level access) so nothing breaks.
- HTTP: `POST /auth/account/login` (public), `GET /auth/account/me`,
  `POST /accounts` + `GET /accounts` + `POST /accounts/:id/disable` (admin only).
- Session visibility: member accounts see only their own sessions in list/queue;
  admin + instance token see all. New sessions attached while authed as an account
  get stamped with that account_id; unauthenticated attach (hook) defaults to admin
  until per-employee hook tokens land (Slice 3).

**Non-goals here:** Face ID UI (Slice 2), server registry/ACL (Slice 3), per-account
SSH key provisioning (Slice 3), admin analytics console (Slice 4), org skills +
Jira mapping (Slice 5). Desktop login UI update lands with Slice 2.

## Shipped after Slice 1 (same day)

- **30-min away timeout** — server: rcwa_ tokens idle out (revoked) after 30 min
  without a request (ACCOUNT_IDLE_MINUTES env, default 30); client: account
  sessions lock after 30 min with the window unfocused. While the app stays
  focused, no re-login is ever required.

## Later slices (tracked, not in this plan)

2. **Face login** — enrollment (admin uploads employee face photos), on-device
   embedding match picks the account; after a first full login (password or Jira
   OAuth) the face unlocks a saved session. Face is identification/UX, never the
   sole stored secret.
2b. **Jira DC OAuth sign-in** — employees authenticate against the org's Jira
   Data Center (OAuth 2.0 authorization-code + PKCE, incoming link). On success
   the API mints a Jira PAT for the user (Jira DC /rest/pat), stores it encrypted
   with the account, and issues the normal rcwa_ session. Needs the admin to
   register an incoming OAuth 2.0 application in Jira (client id/secret → server
   env JIRA_OAUTH_CLIENT_ID / JIRA_OAUTH_CLIENT_SECRET / JIRA_OAUTH_BASE_URL;
   redirect URI https://cowork.chatredstone.com/auth/jira/callback).
3. **Server registry & ACL** — machines table, admin assignment, employee-added
   VPS with automatic cowork public-key install, per-account visibility.
4. **Admin console** — per-employee token spend, session history, live view.
5. **Org skills & Jira** — admin-pushed skills into employee sessions; map employee
   sessions to Jira projects.

## Security notes

- Passwords: scrypt (N=16384,r=8,p=1) with per-user salt; constant-time compare.
- Tokens stored as sha256 hashes only; plaintext shown once.
- Admin password never in repo — seeded via server env (.env, gitignored).
- Employee monitoring (history/token spend) assumes disclosed company policy.
