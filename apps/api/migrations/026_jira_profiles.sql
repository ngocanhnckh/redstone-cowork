-- Per-session Jira integration. `jira_profiles` holds named Jira endpoints: a slug
-- name, a base URL, and the PAT encrypted at rest (AES-256-GCM via the shared
-- CredentialCipher, or plaintext-tagged JSON when CRED_ENCRYPTION_KEY is unset in
-- dev). Sessions bind to a profile + project via the `jira` jsonb column below.

CREATE TABLE IF NOT EXISTS jira_profiles (
  name          text PRIMARY KEY,
  base_url      text NOT NULL,
  pat_encrypted text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Per-session binding: { profile, projectKey, boardId }.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS jira jsonb;
