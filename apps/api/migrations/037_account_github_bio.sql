-- Agent profile: GitHub username (source for GitHub-derived stats) + a free-text bio.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS github text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bio    text NOT NULL DEFAULT '';
