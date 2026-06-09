CREATE TABLE IF NOT EXISTS connections (
  id            UUID PRIMARY KEY,
  kind          TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  label         TEXT,
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_cipher TEXT NOT NULL,
  cursor        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'connected',
  last_sync_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingested_events (
  id          UUID PRIMARY KEY,
  source      TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor       TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  links       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id, type)
);
CREATE INDEX IF NOT EXISTS idx_ingested_events_occurred_at ON ingested_events (occurred_at DESC);
