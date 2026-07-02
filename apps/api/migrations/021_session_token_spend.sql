-- Cumulative token spend + a time-series for the token-spend chart.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_input bigint NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_output bigint NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_series jsonb NOT NULL DEFAULT '[]'::jsonb;
