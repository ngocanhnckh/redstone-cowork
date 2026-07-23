import { describe, it, expect } from "vitest";
import { parsePeers, parseProcesses } from "./host-info";

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

describe("parseProcesses", () => {
  it("parses `ps -eo pid=,comm=,pcpu=,pmem=` (PID first, cpu/mem last) sorted by cpu", () => {
    const raw = [
      " 1234 node        92.4  8.1",
      "   42 postgres    12.0 22.5",
      " 9001 cc          150.2  3.0",
    ].join("\n");
    expect(parseProcesses(raw)).toEqual([
      { pid: 9001, name: "cc", cpu: 150.2, mem: 3.0 },
      { pid: 1234, name: "node", cpu: 92.4, mem: 8.1 },
      { pid: 42, name: "postgres", cpu: 12.0, mem: 22.5 },
    ]);
  });

  it("parses the `ps aux` fallback and skips its header row", () => {
    const raw = [
      "USER  PID %CPU %MEM   VSZ   RSS TTY STAT START TIME COMMAND",
      "root  777 40.5  2.1 12345  6789 ?   Ssl  10:00 0:03 /usr/bin/node",
      "pg    888  5.0 30.0 99999 88888 ?   S    09:00 1:20 /usr/lib/postgres",
    ].join("\n");
    expect(parseProcesses(raw)).toEqual([
      { pid: 777, name: "node", cpu: 40.5, mem: 2.1 },
      { pid: 888, name: "postgres", cpu: 5.0, mem: 30.0 },
    ]);
  });

  it("caps at 12 and returns empty for garbage", () => {
    const many = Array.from({ length: 20 }, (_, i) => `${i + 1} proc${i} ${i} 1.0`).join("\n");
    expect(parseProcesses(many)).toHaveLength(12);
    expect(parseProcesses("nonsense\n\n")).toEqual([]);
  });
});
