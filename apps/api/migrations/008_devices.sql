CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS devices_token_hash_idx ON devices (token_hash);
