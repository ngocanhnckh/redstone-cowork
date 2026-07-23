-- Long-lived host provisioning tokens: minted when an agent provisions a server so
-- the installed redstone agent authenticates without the 30-min idle expiry that
-- governs interactive session tokens.
ALTER TABLE account_tokens ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'session';  -- 'session' | 'host'
