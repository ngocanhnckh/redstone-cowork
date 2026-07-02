-- Reachable address (public IP) + ssh port a host agent detects, so the desktop
-- can auto-resolve the SSH target for a machine without manual config.
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS ssh_port integer;
