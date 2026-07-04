import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "rcw-ws-"));
vi.mock("electron", () => ({
  app: { getPath: () => dir },
}));

import {
  getSshTarget,
  setServerHosts,
  setSshHost,
  __setRelayDepsForTest,
  type ServerHost,
} from "./workspace";

const HOST: ServerHost = {
  id: "host-uuid-1",
  machine: "buildbox",
  user: "dev",
  address: "10.0.0.5",
  sshPort: 22,
};

const COORDS = { relayHost: "your-server.example.com", relayPort: 22, tunnelUser: "rcwtun", tunnelPort: 30001 };

describe("getSshTarget relay-vs-direct decision", () => {
  beforeEach(() => {
    setSshHost("buildbox", ""); // clear any manual override from a prior test
    setServerHosts([HOST]); // also clears the probe cache
  });

  it("returns the direct host with no opts when the host is reachable", async () => {
    const fetchTunnel = vi.fn().mockResolvedValue(COORDS);
    __setRelayDepsForTest({
      probe: async () => true,
      fetchTunnel,
      ensureRegistered: async () => true,
    });
    const t = await getSshTarget("buildbox");
    expect(t).toEqual({ host: "dev@10.0.0.5", opts: [] });
    expect(fetchTunnel).not.toHaveBeenCalled();
  });

  it("falls back to a relay ProxyCommand when the host is unreachable", async () => {
    const fetchTunnel = vi.fn().mockResolvedValue(COORDS);
    __setRelayDepsForTest({
      probe: async () => false,
      fetchTunnel,
      ensureRegistered: async () => true,
    });
    const t = await getSshTarget("buildbox");
    expect(t.host).toBe("dev@10.0.0.5"); // host kept for end-to-end identity/auth
    expect(fetchTunnel).toHaveBeenCalledWith("host-uuid-1");
    expect(t.opts[0]).toBe("-o");
    expect(t.opts[1]).toContain("ProxyCommand=ssh -i");
    expect(t.opts[1]).toContain("-W localhost:30001");
    expect(t.opts[1]).toContain("-p 22");
    expect(t.opts[1]).toContain("rcwtun@your-server.example.com");
  });

  it("stays direct (no relay) when the host is unknown to the server (no hostId)", async () => {
    setServerHosts([]); // no record → no id to look up a tunnel
    const fetchTunnel = vi.fn().mockResolvedValue(COORDS);
    __setRelayDepsForTest({
      probe: async () => false,
      fetchTunnel,
      ensureRegistered: async () => true,
    });
    const t = await getSshTarget("buildbox");
    expect(t).toEqual({ host: "buildbox", opts: [] });
    expect(fetchTunnel).not.toHaveBeenCalled();
  });

  it("falls back to direct when the tunnel lookup fails", async () => {
    __setRelayDepsForTest({
      probe: async () => false,
      fetchTunnel: async () => {
        throw new Error("404");
      },
      ensureRegistered: async () => true,
    });
    const t = await getSshTarget("buildbox");
    expect(t).toEqual({ host: "dev@10.0.0.5", opts: [] });
  });

  it("probes the real address, NOT an ssh-config alias, and stays direct", async () => {
    // A manual override makes getSshHost return an alias that net.connect() can't
    // resolve (it isn't real DNS). The relay must NOT fire: we probe rec.address.
    const ALIAS = "some-ssh-config-alias"; // stands in for any ~/.ssh/config Host name
    setSshHost("buildbox", ALIAS);
    setServerHosts([HOST]); // rec.address = 10.0.0.5, and re-clears the probe cache
    const probe = vi.fn(async (addr: string) => addr === HOST.address); // only the real IP is reachable
    const fetchTunnel = vi.fn().mockResolvedValue(COORDS);
    __setRelayDepsForTest({ probe, fetchTunnel, ensureRegistered: async () => true });
    const t = await getSshTarget("buildbox");
    expect(t).toEqual({ host: ALIAS, opts: [] }); // direct via the alias, no relay
    expect(probe).toHaveBeenCalledWith(HOST.address, HOST.sshPort, expect.any(Number));
    expect(fetchTunnel).not.toHaveBeenCalled();
  });

  it("caches the decision for a machine within the TTL (probes once)", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    __setRelayDepsForTest({ probe, fetchTunnel: async () => COORDS, ensureRegistered: async () => true });
    await getSshTarget("buildbox");
    await getSshTarget("buildbox");
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
