-- Small key/value store for instance-level settings (e.g. the linked Redstone owner sub).
CREATE TABLE IF NOT EXISTS instance_settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);
