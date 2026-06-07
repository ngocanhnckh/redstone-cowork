CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  machine TEXT NOT NULL,
  cwd TEXT NOT NULL,
  git_branch TEXT,
  attached_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body JSONB NOT NULL DEFAULT '{}'::jsonb,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions (status);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions (session_id);
