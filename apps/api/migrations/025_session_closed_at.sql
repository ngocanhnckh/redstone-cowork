-- Soft-close: retire a session (transcript cleared/rotated, or user-dismissed)
-- without deleting its history. Closed sessions drop out of the cockpit lists.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS closed_at timestamptz;
