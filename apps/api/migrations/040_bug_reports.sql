-- Problem reports submitted from the desktop app. These used to be emailed, which
-- meant a report was lost outright whenever SMTP wasn't configured. They are now
-- stored here so nothing a user takes the trouble to report is ever dropped.
CREATE TABLE IF NOT EXISTS bug_reports (
  id           text PRIMARY KEY,
  account_id   text REFERENCES accounts(id) ON DELETE SET NULL,
  username     text NOT NULL DEFAULT '',
  message      text NOT NULL DEFAULT '',
  log          text NOT NULL DEFAULT '',
  context      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'open',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bug_reports_created_idx ON bug_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status_idx ON bug_reports (status);
