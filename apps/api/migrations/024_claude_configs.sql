-- Named Claude endpoint config profiles. Each row is a profile: a slug name and
-- its env map encrypted at rest (AES-256-GCM via the shared CredentialCipher, or
-- plaintext JSON when CRED_ENCRYPTION_KEY is unset in dev). The host agent CLI
-- fetches a profile by name and injects the env into a Claude session.

CREATE TABLE IF NOT EXISTS claude_configs (
  name          text PRIMARY KEY,
  env_encrypted text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
