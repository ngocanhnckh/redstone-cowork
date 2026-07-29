import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rcw-provider-"));
vi.mock("electron", () => ({ app: { getPath: () => tmp } }));
vi.mock("../ssh-config", () => ({ listSshConfigHosts: () => [] }));

import { DirectProvider } from "./direct-provider";
import { addHost, setEnabled, LOCAL_HOST_ID } from "./host-book";

// Opt-in full-stack test: host book -> probe channel -> engine -> provider, against a
// real host. This is the cockpit's actual data path with no agent and no server.
//
//   RCW_PROBE_HOST=<host> pnpm --filter @rcw/desktop test direct-provider.remote

const HOST = process.env.RCW_PROBE_HOST;
const maybe = HOST ? describe : describe.skip;

maybe(`DirectProvider (remote: ${HOST ?? "unset"})`, () => {
  let provider: DirectProvider;
  let stop: () => void;

  beforeAll(async () => {
    // Only the remote host — disable the local machine so results are unambiguous.
    addHost({ label: HOST!, sshHost: HOST! });
    setEnabled(LOCAL_HOST_ID, false);

    provider = new DirectProvider();
    stop = provider.start(() => {});
    // Give the channel time to connect and the first refresh to land.
    for (let i = 0; i < 60; i++) {
      if (((await provider.getSessions()) as unknown[]).length > 0) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }, 90_000);

  afterAll(() => { stop?.(); });

  it("serves sessions through the same shape the cockpit already renders", async () => {
    const sessions = (await provider.getSessions()) as Array<Record<string, unknown>>;
    expect(sessions.length).toBeGreaterThan(0);
    console.log(`\n[${HOST}] provider served ${sessions.length} session(s)`);

    for (const s of sessions) {
      // Every field SessionView requires must be present and correctly typed —
      // the renderer is unchanged, so a missing field is a runtime crash.
      for (const k of [
        "id", "machine", "cwd", "status", "pendingDecisions", "latestAnswer", "summary",
        "todos", "userTodos", "tags", "transcript", "working", "contextTokens", "model",
        "tokensInput", "tokensOutput", "tokenSeries", "pinned", "snoozedUntil",
        "lastSeenAt", "attachedAt", "permissionMode", "autoModeEnabled",
      ]) {
        expect(s, `missing ${k}`).toHaveProperty(k);
      }
      expect(Array.isArray(s.todos)).toBe(true);
      expect(Array.isArray(s.transcript)).toBe(true);
      expect(typeof s.working).toBe("boolean");
      expect(["active", "waiting", "stale", "lost"]).toContain(s.status);
    }
  }, 120_000);

  it("exposes hosts for the SSH resolver", async () => {
    const hosts = await provider.getHosts();
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts[0]).toHaveProperty("machine");
  });

  it("samples live telemetry per host", async () => {
    const t = (await provider.getTelemetry()) as Array<Record<string, number>>;
    expect(t.length).toBeGreaterThan(0);
    expect(t[0].ramTotal).toBeGreaterThan(0);
    console.log(`[${HOST}] telemetry: ram ${Math.round(t[0].ramUsed / 1e9)}/${Math.round(t[0].ramTotal / 1e9)}GB`);
  }, 60_000);

  it("derives a queue that respects pin and snooze", async () => {
    const sessions = (await provider.getSessions()) as Array<{ id: string }>;
    const target = sessions[0].id;

    await provider.pin(target, true);
    const pinned = (await provider.getSessions()) as Array<{ id: string; pinned: boolean }>;
    expect(pinned.find((s) => s.id === target)!.pinned).toBe(true);

    await provider.snooze(target, 60);
    const queue = (await provider.getQueue()) as Array<{ id: string }>;
    expect(queue.some((s) => s.id === target), "a snoozed session must leave the queue").toBe(false);

    await provider.pin(target, false);
  }, 60_000);

  it("persists tags locally, since the host has nowhere to store them", async () => {
    const sessions = (await provider.getSessions()) as Array<{ id: string }>;
    const target = sessions[0].id;
    await provider.addTag(target, "review");
    const tagged = (await provider.getSessions()) as Array<{ id: string; tags: string[] }>;
    expect(tagged.find((s) => s.id === target)!.tags).toContain("review");
    await provider.removeTag(target, "review");
  }, 60_000);

  it("refuses to type into Claude rather than silently doing nothing", async () => {
    // Delivery lands in the next phase. A control that appears to work and doesn't is
    // worse than one that says it can't yet — the cockpit shows this inline.
    await expect(provider.instruct()).rejects.toThrow(/tmux delivery/);
    await expect(provider.interrupt()).rejects.toThrow(/tmux delivery/);
  });
});
