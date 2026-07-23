-- Server registry: a curated catalog of machines agents can open sessions on.
-- Company servers (owner_account_id NULL) are assigned to agents by the admin;
-- agents can also self-add their own VPS (owner_account_id = them, auto-accessible).
CREATE TABLE IF NOT EXISTS servers (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  host          text NOT NULL,           -- hostname / IP used for SSH
  ssh_user      text NOT NULL DEFAULT 'root',
  ssh_port      integer NOT NULL DEFAULT 22,
  description   text NOT NULL DEFAULT '',
  owner_account_id text REFERENCES accounts(id) ON DELETE CASCADE,  -- NULL = company server
  key_installed boolean NOT NULL DEFAULT false,   -- cowork public key confirmed on the box
  created_by    text REFERENCES accounts(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS servers_owner_idx ON servers(owner_account_id);

-- ACL: which agents may use which (company) servers. Self-added servers don't need a
-- row here — ownership grants access.
CREATE TABLE IF NOT EXISTS server_access (
  server_id   text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  account_id  text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, account_id)
);
CREATE INDEX IF NOT EXISTS server_access_account_idx ON server_access(account_id);
