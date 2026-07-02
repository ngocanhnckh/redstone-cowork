-- User-applied tags per session (organizing / filtering).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
