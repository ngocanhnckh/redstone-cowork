-- Jira-effort scoring. The team-performance board: score = Σ Original-Estimate hours of
-- completed issues − Σ non-voided penalties, per Jira project, per Mon–Sun week. Completions
-- and penalties are detected by a changelog scanner and stored here so they can be
-- deduplicated, historicised, and (for penalties) voided by an admin.

-- Per-project config (admin-managed). Empty complete_statuses = "any Done-category status".
CREATE TABLE IF NOT EXISTS scoring_project_config (
  project_key               text PRIMARY KEY,
  complete_statuses         text[] NOT NULL DEFAULT '{}',   -- Jira status NAMES that earn credit
  reopen_penalty_pct        integer NOT NULL DEFAULT 30,
  followup_penalty_pct      integer NOT NULL DEFAULT 30,
  week_timezone             text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  default_team_target       numeric NOT NULL DEFAULT 0,
  default_individual_target numeric NOT NULL DEFAULT 0,
  enabled                   boolean NOT NULL DEFAULT true,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                text REFERENCES accounts(id) ON DELETE SET NULL
);

-- One credit per issue's FIRST completion. PK on issue_key makes rescans idempotent.
CREATE TABLE IF NOT EXISTS scoring_completions (
  issue_key       text PRIMARY KEY,
  project_key     text NOT NULL,
  account_id      text REFERENCES accounts(id) ON DELETE SET NULL,   -- NULL = unmapped Jira user
  jira_user       text NOT NULL DEFAULT '',                          -- assignee-at-completion snapshot
  estimate_hours  numeric NOT NULL,
  complete_status text NOT NULL DEFAULT '',
  completed_at    timestamptz NOT NULL,
  week_key        text NOT NULL,                                     -- Monday YYYY-MM-DD (in project tz)
  detected_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scoring_completions_pw_idx ON scoring_completions(project_key, week_key);
CREATE INDEX IF NOT EXISTS scoring_completions_acct_idx ON scoring_completions(account_id, project_key);

-- Voidable penalty ledger. dedupe_key makes each distinct reopen/followup insert-once.
CREATE TABLE IF NOT EXISTS scoring_penalties (
  id                  text PRIMARY KEY,
  project_key         text NOT NULL,
  issue_key           text NOT NULL,
  account_id          text REFERENCES accounts(id) ON DELETE SET NULL,
  jira_user           text NOT NULL DEFAULT '',
  type                text NOT NULL CHECK (type IN ('reopen','followup')),
  task_estimate_hours numeric NOT NULL,
  penalty_pct         integer NOT NULL,
  points              numeric NOT NULL,          -- negative: -(estimate_hours * pct/100)
  detail              text NOT NULL DEFAULT '',
  occurred_at         timestamptz NOT NULL,
  week_key            text NOT NULL,             -- = the completion's week (offsets that week's credit)
  dedupe_key          text NOT NULL UNIQUE,      -- 'KEY|reopen|<historyId>' / 'KEY|followup|<linkedKey>'
  voided              boolean NOT NULL DEFAULT false,
  voided_by           text REFERENCES accounts(id) ON DELETE SET NULL,
  voided_at           timestamptz,
  detected_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scoring_penalties_pw_idx ON scoring_penalties(project_key, week_key);
CREATE INDEX IF NOT EXISTS scoring_penalties_acct_idx ON scoring_penalties(account_id, project_key);

-- Per-project scan high-water mark (max Jira `updated` processed).
CREATE TABLE IF NOT EXISTS scoring_scan_cursor (
  project_key  text PRIMARY KEY,
  last_updated timestamptz,
  last_run_at  timestamptz
);

-- Per-project, per-week admin targets (override the config defaults).
CREATE TABLE IF NOT EXISTS scoring_targets (
  project_key       text NOT NULL,
  week_key          text NOT NULL,
  team_target       numeric NOT NULL DEFAULT 0,
  individual_target numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (project_key, week_key)
);

-- Admin-picked critical/committed issues for a project-week (a tracked checklist; done-ness
-- is computed live from the issue's current status, not stored).
CREATE TABLE IF NOT EXISTS scoring_critical (
  project_key text NOT NULL,
  week_key    text NOT NULL,
  issue_key   text NOT NULL,
  summary     text NOT NULL DEFAULT '',
  added_by    text REFERENCES accounts(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_key, week_key, issue_key)
);
