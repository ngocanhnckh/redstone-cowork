-- Face biometric sign-in. Descriptors (128-float face embeddings, computed on-device
-- with face-api.js) are stored per account — the raw photo/frames never reach the DB.
-- Sign-in is TWO-factor: the biometric match PLUS a device-bound secret established at
-- first full login; face is never the sole secret.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS face_descriptors jsonb NOT NULL DEFAULT '[]'::jsonb;

-- A trusted device (possession factor). Created on the first full login on a device
-- when the agent opts into face unlock; the raw secret is shown once to that client.
CREATE TABLE IF NOT EXISTS device_trust (
  id           text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  secret_hash  text NOT NULL UNIQUE,   -- sha-256 of the device secret (never plaintext)
  label        text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS device_trust_account_idx ON device_trust(account_id);
