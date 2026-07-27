import { describe, it, expect } from "vitest";
import { parseSshConfig } from "./ssh-config";

describe("parseSshConfig", () => {
  it("extracts concrete hosts with HostName/User/Port, skipping wildcards", () => {
    const cfg = `
# comment
Host csd2
  HostName 217.216.111.217
  User anhnguyen
  Port 22

Host *
  ServerAliveInterval 60

Host web prod
  HostName 10.0.0.9
  User deploy
`;
    const hosts = parseSshConfig(cfg);
    expect(hosts.find((h) => h.alias === "csd2")).toEqual({ alias: "csd2", hostName: "217.216.111.217", user: "anhnguyen", port: 22 });
    // multi-alias line applies the same block to each
    expect(hosts.find((h) => h.alias === "web")).toMatchObject({ hostName: "10.0.0.9", user: "deploy" });
    expect(hosts.find((h) => h.alias === "prod")).toMatchObject({ hostName: "10.0.0.9", user: "deploy" });
    // wildcard Host * is not a pickable host
    expect(hosts.some((h) => h.alias === "*")).toBe(false);
  });

  it("returns [] for empty/garbage and defaults missing fields to null", () => {
    expect(parseSshConfig("")).toEqual([]);
    const h = parseSshConfig("Host bare\n");
    expect(h).toEqual([{ alias: "bare", hostName: null, user: null, port: null }]);
  });
});
