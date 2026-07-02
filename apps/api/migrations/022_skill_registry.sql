-- Cross-host skill union registry: the canonical, persisted source of truth for
-- skill distribution. One row per skill name (deduped across all hosts). Content
-- (files) is captured from whichever host first reported the skill, or pushed by
-- an org system via POST /skills.

CREATE TABLE IF NOT EXISTS skill_registry (
  name            text PRIMARY KEY,
  description     text,
  source          text NOT NULL DEFAULT 'personal',
  hash            text NOT NULL,
  files           jsonb NOT NULL DEFAULT '[]'::jsonb,
  origin_host_id  text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
