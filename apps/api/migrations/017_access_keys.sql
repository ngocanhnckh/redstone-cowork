-- Dedicated, revocable access keys for the external inventory/control API.
CREATE TABLE IF NOT EXISTS access_keys (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  key_hash      text NOT NULL UNIQUE,   -- sha-256 of the plaintext key (never store the key)
  prefix        text NOT NULL,          -- first chars, for display
  scope         text NOT NULL DEFAULT 'read',  -- 'read' | 'control'
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS access_keys_hash_idx ON access_keys(key_hash);
