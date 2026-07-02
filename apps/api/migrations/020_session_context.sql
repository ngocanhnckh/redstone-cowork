-- Context-window usage (tokens) + model for the session's latest turn.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_tokens bigint;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS model text;
