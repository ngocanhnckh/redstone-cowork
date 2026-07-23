import { describe, it, expect } from "vitest";
import { parseNet } from "./network";

describe("parseNet", () => {
  it("extracts peer ip/port and the owning process from `ss -tnp`, deduped by ip", () => {
    const raw = [
      "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
      'ESTAB 0 0 10.0.0.5:52210 140.82.113.25:443 users:(("node",pid=1234,fd=20))',
      'ESTAB 0 0 10.0.0.5:52444 140.82.113.25:443 users:(("node",pid=1234,fd=21))',
      'ESTAB 0 0 10.0.0.5:22 203.0.113.9:41022 users:(("sshd",pid=5,fd=3))',
    ].join("\n");
    const peers = parseNet(raw);
    expect(peers).toEqual([
      { ip: "140.82.113.25", port: 443, proc: "node", count: 2 },
      { ip: "203.0.113.9", port: 41022, proc: "sshd", count: 1 },
    ]);
  });

  it("works without the process column (`ss -tn`) and drops loopback/link-local", () => {
    const raw = [
      "ESTAB 0 0 10.0.0.5:443 8.8.8.8:53",
      "ESTAB 0 0 127.0.0.1:5432 127.0.0.1:60122",
      "ESTAB 0 0 10.0.0.5:22 169.254.1.2:5000",
    ].join("\n");
    expect(parseNet(raw)).toEqual([{ ip: "8.8.8.8", port: 53, proc: null, count: 1 }]);
  });

  it("returns empty for garbage", () => {
    expect(parseNet("no sockets here\n")).toEqual([]);
  });
});
