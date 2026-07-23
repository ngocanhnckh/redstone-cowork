-- Agent profile fields, admin-managed from the roster dashboard. The photo doubles
-- as the face-enrollment source for Slice 2 (admin uploads it before the employee
-- ever signs in). Stored as a data URL (client resizes to ~512px before upload).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS photo      text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS level      text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS division   text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email      text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS jira       text NOT NULL DEFAULT '';  -- Jira DC username
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mattermost text NOT NULL DEFAULT '';  -- Mattermost handle
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS phone      text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS webhook    text NOT NULL DEFAULT '';  -- personal webhook: Jira task/mission notifications get forwarded here
