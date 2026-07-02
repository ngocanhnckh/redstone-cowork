# Authenticate users via Redstone (OAuth2 / OIDC provider)

Redstone can act as an **identity provider** for another product: your product's
users sign in with their Redstone credentials, and your backend receives a
verified identity (user id, email, name) without storing passwords itself.

This is the **token-API** flow — no browser redirect/consent screen. Your
product's backend collects the user's Redstone username + password on its own
login form, exchanges them for tokens at Redstone's token endpoint (authenticating
itself with a `client_id` + `client_secret`), then verifies identity via
`userinfo` / `introspect`.

> If you instead want a "Login with Redstone" **redirect SSO** button
> (Authorization Code flow), that is a separate, larger feature — ask the
> Redstone team.

---

## 1. Register your product (one-time)

Redstone reads registered clients from the `OAUTH2_CLIENTS` environment variable
(JSON array). Ask a Redstone admin to add your client:

```bash
# backend/.env (or the deployment's environment)
OAUTH2_CLIENTS=[{"client_id":"acme-portal","client_secret":"<random 32+ byte secret>","name":"Acme Portal"}]

# Also make sure the public issuer URL is correct (used in id_token `iss`
# and the discovery document):
PUBLIC_BASE_URL=https://redstone-agent.examplehost.dev
```

Generate a strong secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Multiple clients are supported — add more objects to the array. Keep the
`client_secret` server-side only; never ship it in a browser/SPA.

---

## 2. Endpoints

Base path: `https://<redstone-host>/api/v1/oauth2`

| Method & path | Purpose | Auth |
|---|---|---|
| `GET  /.well-known/openid-configuration` | Discovery metadata | none |
| `POST /token` | Exchange credentials → tokens | client (`client_id`+`client_secret`) |
| `GET  /userinfo` | Identity claims for an access token | Bearer access token |
| `POST /introspect` | Is this token active? whose is it? (RFC 7662) | client |

Client authentication accepts **HTTP Basic** (`Authorization: Basic base64(id:secret)`,
i.e. `client_secret_basic`) or **form fields** (`client_id` + `client_secret`,
i.e. `client_secret_post`). Requests are `application/x-www-form-urlencoded`.

---

## 3. The flow

### 3.1 Get tokens (password grant)

Your backend posts the user's Redstone credentials + your client credentials:

```bash
curl -X POST https://<host>/api/v1/oauth2/token \
  -d grant_type=password \
  -d username='alice' \
  --data-urlencode password='the-users-password' \
  -d client_id='acme-portal' \
  -d client_secret='<your secret>'
```

Response:

```json
{
  "access_token": "eyJhbGciOi…",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "openid profile email",
  "refresh_token": "eyJhbGciOi…",
  "id_token": "eyJhbGciOi…"
}
```

- **`access_token`** — a Redstone JWT. Treat it as opaque; verify it via
  `introspect`/`userinfo` (it is signed with Redstone's internal key, not yours).
- **`id_token`** — an OIDC JWT signed **HS256 with your `client_secret`**, so you
  can verify it locally with no extra round-trip (see §3.2).
- **`refresh_token`** — exchange for a fresh access token (§3.4).

### 3.2 Verify the `id_token` locally

Because the `id_token` is signed with your own `client_secret`, your backend
verifies it offline:

```python
import jwt  # pyjwt

claims = jwt.decode(
    id_token,
    key=CLIENT_SECRET,
    algorithms=["HS256"],
    audience="acme-portal",       # must equal your client_id
    issuer="https://<host>",      # must equal Redstone's PUBLIC_BASE_URL
    options={"require": ["exp", "iat", "sub"]},
)
# claims: sub, email, email_verified, name, preferred_username, redstone_is_admin, iat, exp, aud, iss
user_id = claims["sub"]
```

Reject the token if `aud` ≠ your `client_id`, `iss` ≠ the expected issuer, or it
is expired. That is enough to **know who the user is**.

### 3.3 Or call `userinfo`

If you'd rather ask Redstone directly (e.g. to refresh profile fields):

```bash
curl https://<host>/api/v1/oauth2/userinfo \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "sub": "9bdd28b8-…",
  "preferred_username": "alice",
  "name": "alice",
  "email": "alice@acme.com",
  "email_verified": true,
  "redstone_is_admin": false,
  "updated_at": 1782903431
}
```

### 3.4 Refresh

```bash
curl -X POST https://<host>/api/v1/oauth2/token \
  -d grant_type=refresh_token \
  -d refresh_token='<refresh_token>' \
  -d client_id='acme-portal' -d client_secret='<secret>'
```

Returns a new `access_token` (+ `id_token`).

### 3.5 Introspect (validate any token server-side)

For a resource server that receives a Redstone access token and wants to check it:

```bash
curl -X POST https://<host>/api/v1/oauth2/introspect \
  -d token='<access_token>' \
  -d client_id='acme-portal' -d client_secret='<secret>'
```

Active token:

```json
{
  "active": true,
  "sub": "9bdd28b8-…",
  "username": "alice",
  "email": "alice@acme.com",
  "token_type": "Bearer",
  "scope": "openid profile email",
  "iss": "https://<host>",
  "exp": 1782989831
}
```

Invalid/expired/unknown token → `{"active": false}` (HTTP 200).

---

## 4. Claims

| Claim | Meaning |
|---|---|
| `sub` | Stable Redstone user id (UUID) — use this as the primary key |
| `email`, `email_verified` | User email (present with the `email` scope) |
| `name`, `preferred_username` | Redstone username |
| `redstone_is_admin` | `true` if the user is a Redstone admin (namespaced, non-standard) |
| `iss`, `aud`, `iat`, `exp` | Standard JWT/OIDC registered claims |

Default scope is `openid profile email`. Pass `scope=` on the token request to
narrow it (e.g. `scope=openid` omits the email claim from the `id_token`).

---

## 5. Errors

Token/introspect errors follow RFC 6749 shape:

```json
{ "error": "invalid_grant", "error_description": "Invalid username or password." }
```

| HTTP | `error` | When |
|---|---|---|
| 401 | `invalid_client` | Unknown `client_id` or wrong `client_secret` |
| 400 | `invalid_request` | Missing required params (e.g. username/password) |
| 400 | `invalid_grant` | Bad user credentials or expired refresh token |
| 400 | `unsupported_grant_type` | `grant_type` other than `password` / `refresh_token` |
| 401 | `invalid_token` | `userinfo` with a missing/invalid Bearer token |

---

## 6. Token lifetimes & security

- **Access token** ≈ 24h (`JWT_ACCESS_TOKEN_EXPIRE_MINUTES`), **refresh token** ≈ 7
  days (`JWT_REFRESH_TOKEN_EXPIRE_DAYS`). `expires_in` is returned in seconds.
- Always call over **HTTPS**. Keep `client_secret` on the server only.
- The `access_token` is a full Redstone user token — store it like a session
  secret and drop it when the user logs out of your product.
- This flow (Resource Owner Password Credentials) is appropriate for a
  **first-party / trusted sibling** product because your backend handles the
  user's Redstone password. For untrusted third parties, use redirect SSO
  instead (not yet implemented).

---

## 7. Discovery

`GET /api/v1/oauth2/.well-known/openid-configuration` returns:

```json
{
  "issuer": "https://<host>",
  "token_endpoint": "https://<host>/api/v1/oauth2/token",
  "userinfo_endpoint": "https://<host>/api/v1/oauth2/userinfo",
  "introspection_endpoint": "https://<host>/api/v1/oauth2/introspect",
  "grant_types_supported": ["password", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
  "id_token_signing_alg_values_supported": ["HS256"],
  "scopes_supported": ["openid", "profile", "email"],
  "claims_supported": ["sub", "email", "email_verified", "name", "preferred_username", "redstone_is_admin"]
}
```

> The URLs here are built from `PUBLIC_BASE_URL`. If discovery shows
> `http://localhost:3071`, set `PUBLIC_BASE_URL` to the real public origin and
> restart the backend.

---

# Resource API — read the user's data & drive the agent

Once you have a user's **access token** (from `POST /oauth2/token`, §3.1), your
product can read that user's Redstone-integrated data and even talk to the agent
on their behalf. Every endpoint is under `/api/v1/me`, is scoped to the token's
user, and takes `Authorization: Bearer <access_token>`. You never handle the
user's per-integration (Mattermost/Google/Jira) tokens — Redstone does.

| Method & path | Returns |
|---|---|
| `GET  /api/v1/me` | The user's profile (`sub`, `username`, `email`, `is_admin`) |
| `GET  /api/v1/me/integrations` | Which integrations are connected |
| `GET  /api/v1/me/sessions` | The user's Redstone chat sessions |
| `GET  /api/v1/me/mattermost/inbox` | Their unread Mattermost inbox |
| `GET  /api/v1/me/gmail/messages` | Their recent unread Gmail |
| `GET  /api/v1/me/jira/issues` | Their current Jira tasks (assigned, open sprint) |
| `POST /api/v1/me/agent/messages` | Send a message to the agent AS the user → reply |

All endpoints return `401` without a valid Bearer access token.

### Profile & connections

```bash
curl https://<host>/api/v1/me -H "Authorization: Bearer $ACCESS"
# { "sub": "9bdd28b8-…", "username": "alice", "email": "alice@acme.com", "is_admin": false }

curl https://<host>/api/v1/me/integrations -H "Authorization: Bearer $ACCESS"
# [ {"provider":"jira","label":"Jira","connected":true},
#   {"provider":"mattermost","label":"Mattermost","connected":true},
#   {"provider":"google","label":"Google (Drive · Gmail · Calendar)","connected":true} ]
```

Data endpoints below return `{"connected": false, "items": []}` when the user
hasn't linked that integration (so you can prompt them to connect it in
Redstone), and `{"connected": true, …, "error": "session_expired"}` if their
stored token needs a refresh/reconnect.

### Mattermost inbox

```bash
curl https://<host>/api/v1/me/mattermost/inbox -H "Authorization: Bearer $ACCESS"
```
```json
{
  "connected": true,
  "items": [
    { "team": "YITEC", "channel": "Repfie", "channelId": "…",
      "unread": 3, "mentions": 1, "lastPostAt": 1782900000000 }
  ]
}
```

### Gmail (recent unread)

```bash
curl https://<host>/api/v1/me/gmail/messages -H "Authorization: Bearer $ACCESS"
```
```json
{
  "connected": true,
  "items": [
    { "id": "18f…", "from_name": "Billing", "from_email": "billing@x.io",
      "subject": "Invoice #29898", "snippet": "…", "date": "…", "unread": true }
  ]
}
```

### Jira tasks

```bash
curl https://<host>/api/v1/me/jira/issues -H "Authorization: Bearer $ACCESS"
```
```json
{
  "connected": true,
  "instance_url": "https://acme.atlassian.net",
  "columns": {
    "todo":        [ { "key": "JP-715", "summary": "…", "status": "To Do", "priority": "High", "due": null, "project": "JP", "url": "…" } ],
    "in_progress": [ … ],
    "done":        [ … ]
  }
}
```

### Chat sessions

```bash
curl https://<host>/api/v1/me/sessions -H "Authorization: Bearer $ACCESS"
# [ { "id": "…", "name": "Urgent Inbox Triage", "source": "ui",
#     "created_at": "…", "updated_at": "…", "message_count": 12 }, … ]
```

### Talk to the agent as the user

```bash
curl -X POST https://<host>/api/v1/me/agent/messages \
  -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" \
  -d '{"message": "What did I miss on Mattermost today?"}'
```
```json
{ "session_id": "2f9c4eed-…", "reply": "You have 3 unread…", "files": [] }
```

- The agent runs **as the user** — it has their memory, integrations, and tools,
  so it can read their Mattermost/Gmail/Jira and answer in context.
- Pass the returned **`session_id`** on subsequent calls to keep the same agent
  workspace + per-user memory.
- This is a **blocking** single-turn call and can take several seconds to a
  minute for tool-heavy questions — use a generous client timeout. For full
  multi-turn transcripts, use the OpenAI-compatible `/v1/chat/completions`
  surface instead.

### Scopes & privacy

The access token is a full user token, so these endpoints expose the user's own
data only. Treat it as a session secret, serve over HTTPS, and drop it on
logout. If you want to restrict which of these a given client may call (e.g.
read-only, no agent), tell the Redstone team — per-client scoping can be added.
