-- Quick-unlock PIN: after the full login, the app locks on restart / away and an
-- agent unlocks with their face OR this PIN (scrypt-hashed, never plaintext). The
-- session token is the real credential; the PIN is a local convenience gate.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pin_hash text;
