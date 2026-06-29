-- Track whether Claude is mid-turn (prompt submitted / running tools) so the
-- cockpit can show a "thinking" indicator until the final answer arrives.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS working BOOLEAN NOT NULL DEFAULT FALSE;
