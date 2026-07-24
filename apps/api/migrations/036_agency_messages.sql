-- Agency messaging: the organisation-wide IRC channel AND agent-to-agent DMs share one
-- table, keyed by `channel` ('org' for the town square, or a sorted-pair 'dm:<a>:<b>'
-- for a direct thread). Attachments are stored as a JSON manifest (files themselves are
-- served from the API's uploads dir); `to_account` is null for the org channel.
CREATE TABLE IF NOT EXISTS agency_messages (
  id           text PRIMARY KEY,
  channel      text NOT NULL,
  from_account text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account   text REFERENCES accounts(id) ON DELETE CASCADE,
  body         text NOT NULL DEFAULT '',
  attachments  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_messages_channel_idx ON agency_messages(channel, created_at);
CREATE INDEX IF NOT EXISTS agency_messages_dm_idx ON agency_messages(to_account, from_account, created_at);
