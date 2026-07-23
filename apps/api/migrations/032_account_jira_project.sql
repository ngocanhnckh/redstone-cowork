-- Org Jira mapping: the admin maps an agent to a default Jira project so their
-- sessions are associated with the right project/mission out of the box.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS jira_project text NOT NULL DEFAULT '';
