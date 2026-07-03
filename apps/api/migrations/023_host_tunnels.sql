-- NAT'd-host SSH relay: per-host reverse-tunnel port assignments + the cockpit
-- jump keys that may reach relay loopback ports. The API rebuilds rcwtun's
-- authorized_keys from these rows. Port pool starts at 30000; lowest free wins.

CREATE TABLE IF NOT EXISTS host_tunnels (
  host_id      text PRIMARY KEY,
  tunnel_port  int UNIQUE NOT NULL,
  agent_pubkey text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Cockpit (desktop) jump keys, one row per registered device/label. These get
-- loopback-only `-W` egress on the relay so they can reach the reverse ports.
CREATE TABLE IF NOT EXISTS tunnel_cockpit_keys (
  label      text PRIMARY KEY,
  pubkey     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
