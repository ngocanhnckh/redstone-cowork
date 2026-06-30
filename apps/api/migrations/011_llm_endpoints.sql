-- User-added custom OpenAI-compatible LLM endpoints. API key stored encrypted
-- (AES-256-GCM via CredentialCipher); presets stay in env, not here.
CREATE TABLE IF NOT EXISTS llm_endpoints (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  model       TEXT NOT NULL,
  key_cipher  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
