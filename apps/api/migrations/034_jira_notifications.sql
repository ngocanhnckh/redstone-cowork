-- Per-agent Jira notifications: when a Jira issue ASSIGNED to an agent (any project)
-- is created/updated, the shared org webhook records a notification here; the agent's
-- app polls and shows a futuristic in-app alert. Replaces the per-agent webhook URL.
CREATE TABLE IF NOT EXISTS jira_notifications (
  id          text PRIMARY KEY,
  account_id  text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  issue_key   text NOT NULL,
  summary     text NOT NULL DEFAULT '',
  event       text NOT NULL DEFAULT '',      -- e.g. "issue_assigned", "issue_updated"
  status      text NOT NULL DEFAULT '',
  actor       text NOT NULL DEFAULT '',       -- who made the change
  url         text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  seen_at     timestamptz
);
CREATE INDEX IF NOT EXISTS jira_notif_account_idx ON jira_notifications(account_id, created_at DESC);

-- Drop the now-unused per-agent fields (webhook forward + single project lock).
ALTER TABLE accounts DROP COLUMN IF EXISTS webhook;
ALTER TABLE accounts DROP COLUMN IF EXISTS jira_project;
