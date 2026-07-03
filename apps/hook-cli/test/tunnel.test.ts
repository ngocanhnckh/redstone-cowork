import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock child_process.execFile before importing the module under test so the
// promisified execFile inside tunnel.ts uses our stub.
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }));

import { ensureTunnelKey, buildTunnelArgs, tunnelKeyPath } from "../src/tunnel";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rcw-tunnel-"));
  execFileMock.mockReset();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("ensureTunnelKey", () => {
  it("returns null gracefully when ssh-keygen fails", async () => {
    // promisify(execFile) invokes the callback; simulate a failure (binary missing).
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error) => void) => {
      cb(new Error("spawn ssh-keygen ENOENT"));
    });
    const res = await ensureTunnelKey(home);
    expect(res).toBeNull();
  });

  it("returns the existing pubkey contents without regenerating", async () => {
    writeFileSync(tunnelKeyPath(home), "PRIVATE");
    writeFileSync(`${tunnelKeyPath(home)}.pub`, "ssh-ed25519 AAAAKEY redstone-tunnel\n");
    const res = await ensureTunnelKey(home);
    expect(res).not.toBeNull();
    expect(res?.pubkey).toBe("ssh-ed25519 AAAAKEY redstone-tunnel");
    expect(res?.privKeyPath).toBe(tunnelKeyPath(home));
    // Key already present → ssh-keygen must not run.
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("generates a key when absent, then reads the produced pubkey", async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
      // Emulate ssh-keygen writing the .pub file.
      writeFileSync(tunnelKeyPath(home), "PRIVATE");
      writeFileSync(`${tunnelKeyPath(home)}.pub`, "ssh-ed25519 GENERATED redstone-tunnel\n");
      cb(null);
    });
    const res = await ensureTunnelKey(home);
    expect(execFileMock).toHaveBeenCalledOnce();
    expect(res?.pubkey).toBe("ssh-ed25519 GENERATED redstone-tunnel");
  });
});

describe("buildTunnelArgs", () => {
  it("assembles the reverse-tunnel ssh argv with the expected flags and port mapping", () => {
    const args = buildTunnelArgs(
      { relayHost: "your-server.example.com", relayPort: 22, tunnelUser: "rcwtun", tunnelPort: 30001 },
      "/home/u/.redstone/tunnel_ed25519",
      "/home/u/.redstone/relay_known_hosts"
    );
    expect(args).toEqual([
      "-N",
      "-T",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "UserKnownHostsFile=/home/u/.redstone/relay_known_hosts",
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-o", "PreferredAuthentications=publickey",
      "-o", "PasswordAuthentication=no",
      "-o", "KbdInteractiveAuthentication=no",
      "-o", "NumberOfPasswordPrompts=0",
      "-o", "ConnectTimeout=10",
      "-i", "/home/u/.redstone/tunnel_ed25519",
      "-R", "30001:localhost:22",
      "-p", "22",
      "rcwtun@your-server.example.com",
    ]);
  });

  it("forces publickey-only, non-interactive auth (no password fall-through)", () => {
    const args = buildTunnelArgs(
      { relayHost: "h", relayPort: 22, tunnelUser: "rcwtun", tunnelPort: 30000 },
      "/k",
      "/kh"
    );
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("PreferredAuthentications=publickey");
    expect(args).toContain("PasswordAuthentication=no");
    expect(args).not.toContain("PasswordAuthentication=yes");
  });
});
