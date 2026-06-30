-- Per-endpoint output token cap for custom LLM endpoints (null = server default).
ALTER TABLE llm_endpoints ADD COLUMN IF NOT EXISTS max_tokens INTEGER;
