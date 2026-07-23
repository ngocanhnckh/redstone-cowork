import { describe, it, expect } from "vitest";
import { parsePeers } from "./host-info";

describe("parsePeers", () => {
  it("extracts the peer (last) IPv4:port from each ss row and dedupes by IP", () => {
    const raw = [
      "State  Recv-Q Send-Q Local Address:Port Peer Address:Port",
      "ESTAB  0      0      10.0.0.5:22        203.0.113.7:51514",
      "ESTAB  0      0      10.0.0.5:443       198.51.100.9:40122",
      "ESTAB  0      0      10.0.0.5:443       198.51.100.9:40188",
    ].join("\n");
    const peers = parsePeers(raw);
    // 203.0.113.7 (1) and 198.51.100.9 (2), sorted by descending count.
    expect(peers).toEqual([
      { ip: "198.51.100.9", port: 40122, count: 2 },
      { ip: "203.0.113.7", port: 51514, count: 1 },
    ]);
  });

  it("drops loopback / link-local / wildcard peers", () => {
    const raw = [
      "ESTAB 0 0 127.0.0.1:5432 127.0.0.1:58122",
      "ESTAB 0 0 10.0.0.5:22   169.254.1.1:5000",
      "LISTEN 0 0 0.0.0.0:80   0.0.0.0:*",
      "ESTAB 0 0 10.0.0.5:22   8.8.8.8:53",
    ].join("\n");
    expect(parsePeers(raw)).toEqual([{ ip: "8.8.8.8", port: 53, count: 1 }]);
  });

  it("returns an empty list for empty / garbage input", () => {
    expect(parsePeers("")).toEqual([]);
    expect(parsePeers("no addresses here\njust text")).toEqual([]);
  });
});
