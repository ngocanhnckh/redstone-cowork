ALTER TABLE sessions ADD COLUMN IF NOT EXISTS wrapper_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_wrapper ON sessions (wrapper_id);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_decisions_undelivered ON decisions (session_id) WHERE status = 'resolved' AND delivered_at IS NULL;
