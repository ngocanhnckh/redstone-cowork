-- User-managed checklist per session (distinct from Claude's auto-derived plan todos).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_todos jsonb NOT NULL DEFAULT '[]'::jsonb;
