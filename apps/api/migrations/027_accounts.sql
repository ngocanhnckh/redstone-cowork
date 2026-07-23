-- Enterprise accounts: employees sign in to this cowork installation with their own
-- account; every agent session is owned by an account. Admin sees all.
CREATE TABLE IF NOT EXISTS accounts (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  display_name  text NOT NULL DEFAULT '',
  role          text NOT NULL DEFAULT 'member',       -- 'admin' | 'member'
  password_hash text NOT NULL,                        -- scrypt$N$r$p$salt$hash (never plaintext)
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);

-- Bearer tokens issued at login (plaintext shown once; only the sha-256 is stored).
CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash    text PRIMARY KEY,
  account_id    text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS account_tokens_account_idx ON account_tokens(account_id);

-- Session ownership. Nullable: legacy/hook-attached sessions get claimed by the
-- admin account at seed time (see AccountsService.seedAdmin) and on attach.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_id text REFERENCES accounts(id);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);

-- Login audit trail: every sign-in attempt (success or failure) with source IP and
-- device/user-agent. account_id is null for failed attempts on unknown usernames.
CREATE TABLE IF NOT EXISTS login_audit (
  id          text PRIMARY KEY,
  account_id  text REFERENCES accounts(id) ON DELETE SET NULL,
  username    text NOT NULL,                 -- as typed (kept even when account unknown)
  ok          boolean NOT NULL,
  ip          text NOT NULL DEFAULT '',
  device      text NOT NULL DEFAULT '',      -- user-agent / client-reported device label
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_audit_at_idx ON login_audit(at DESC);
CREATE INDEX IF NOT EXISTS login_audit_account_idx ON login_audit(account_id);
