-- Jira DC OAuth sign-in: after an employee authenticates against the org Jira, the
-- server mints a Personal Access Token for them and stores it encrypted here, keyed
-- to the account. Lets their sessions act as themselves in Jira without re-auth.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS jira_base_url text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS jira_pat_enc  text;  -- AES-256-GCM (CredentialCipher), never plaintext
