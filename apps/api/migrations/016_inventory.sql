-- Session inventory: hosts running Claude Code, the sessions discovered on them
-- (cowork-launched or not), and the command queue the host agent long-polls.

CREATE TABLE IF NOT EXISTS hosts (
  id            text PRIMARY KEY,
  machine       text NOT NULL,
  "user"        text,
  os            text,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discovered_sessions (
  id             text PRIMARY KEY,        -- Claude Code session id
  host_id        text NOT NULL,
  machine        text NOT NULL,
  cwd            text NOT NULL,
  folder         text NOT NULL,
  title          text,
  last_active    timestamptz NOT NULL,
  message_count  integer NOT NULL DEFAULT 0,
  size_bytes     bigint NOT NULL DEFAULT 0,
  source         text NOT NULL DEFAULT 'external',
  tags           jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discovered_sessions_host_idx ON discovered_sessions(host_id);
CREATE INDEX IF NOT EXISTS discovered_sessions_folder_idx ON discovered_sessions(folder);

CREATE TABLE IF NOT EXISTS host_commands (
  id          text PRIMARY KEY,
  host_id     text NOT NULL,
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending',
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS host_commands_pending_idx ON host_commands(host_id, status);
