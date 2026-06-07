CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_domain_events_occurred_at ON domain_events (occurred_at DESC);
