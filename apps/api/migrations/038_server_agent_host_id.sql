-- Link a curated server to its reporting redstone agent by the agent's stable host-id
-- (~/.redstone/host-id). NAT'd/closed hosts report their PUBLIC ip and real hostname, so
-- matching a registry row by the user-typed LAN address or display name fails — the host-id
-- is the one identifier that survives NAT and reinstalls, so we store it and match on it.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_host_id TEXT;
