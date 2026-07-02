import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  HostRegistrationSchema, InventoryReportSchema,
  type Host, type DiscoveredSession, type HostCommand, type HostCommandKind,
} from "@rcw/shared";
import { INVENTORY_STORE, type InventoryStore } from "../domain/inventory/inventory-store.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";
import { InventoryWaiters } from "./inventory-waiters";

const RESULT_WAIT_MS = 120_000; // passive runs can take a while

@Injectable()
export class InventoryService {
  constructor(
    @Inject(INVENTORY_STORE) private readonly store: InventoryStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    private readonly waiters: InventoryWaiters,
  ) {}

  async registerHost(input: unknown): Promise<Host> {
    const r = HostRegistrationSchema.parse(input);
    return this.store.upsertHost({
      id: r.hostId, machine: r.machine, user: r.user ?? null, os: r.os ?? null,
      address: r.address ?? null, sshPort: r.sshPort ?? null, at: new Date(),
    });
  }

  async reportInventory(hostId: string, input: unknown): Promise<void> {
    const { machine, sessions } = InventoryReportSchema.parse(input);
    const coworkIds = new Set((await this.sessions.list()).map((s) => s.id));
    await this.store.reportInventory(hostId, machine, sessions, coworkIds, new Date());
    await this.store.touchHost(hostId, new Date());
  }

  async listHosts(): Promise<Host[]> { return this.store.listHosts(); }

  async list(filter?: { hostId?: string; folder?: string; tag?: string; source?: string }): Promise<DiscoveredSession[]> {
    return this.store.listDiscovered(filter);
  }
  getDiscovered(id: string) { return this.store.getDiscovered(id); }

  async addTag(id: string, tag: string): Promise<DiscoveredSession | null> {
    const d = await this.store.getDiscovered(id);
    if (!d) return null;
    const clean = tag.trim().slice(0, 40);
    if (!clean || d.tags.some((t) => t.toLowerCase() === clean.toLowerCase())) return d;
    return this.store.setTags(id, [...d.tags, clean]);
  }
  async removeTag(id: string, tag: string): Promise<DiscoveredSession | null> {
    const d = await this.store.getDiscovered(id);
    if (!d) return null;
    return this.store.setTags(id, d.tags.filter((t) => t.toLowerCase() !== tag.trim().toLowerCase()));
  }

  // ---- Host command queue ----

  /** Host agent long-polls for work. Returns immediately if commands are pending. */
  async pollCommands(hostId: string, timeoutMs: number): Promise<HostCommand[]> {
    await this.store.touchHost(hostId, new Date());
    const pending = await this.store.listPendingCommands(hostId);
    if (pending.length > 0) return pending;
    await this.waiters.waitForCommand(hostId, Math.min(timeoutMs, 30_000));
    return this.store.listPendingCommands(hostId);
  }

  async completeCommand(id: string, result: Record<string, unknown>): Promise<boolean> {
    const done = await this.store.completeCommand(id, result);
    if (done) this.waiters.notifyResult(id);
    return !!done;
  }

  /** Pending (not-yet-executed) commands for a host — used to dedupe fan-out enqueues. */
  async pendingCommands(hostId: string): Promise<HostCommand[]> {
    return this.store.listPendingCommands(hostId);
  }

  /** Fire-and-forget enqueue (no waiting for a result) — used by skill sync fan-out. */
  async enqueue(hostId: string, kind: HostCommandKind, payload: Record<string, unknown>): Promise<HostCommand> {
    const cmd: HostCommand = { id: randomUUID(), hostId, kind, payload, status: "pending", result: null, createdAt: new Date() };
    await this.store.enqueueCommand(cmd);
    this.waiters.notifyHost(hostId);
    return cmd;
  }

  private async enqueueAndWait(hostId: string, kind: HostCommandKind, payload: Record<string, unknown>): Promise<HostCommand | null> {
    const cmd: HostCommand = { id: randomUUID(), hostId, kind, payload, status: "pending", result: null, createdAt: new Date() };
    await this.store.enqueueCommand(cmd);
    this.waiters.notifyHost(hostId);
    await this.waiters.waitForResult(cmd.id, RESULT_WAIT_MS);
    return this.store.getCommand(cmd.id);
  }

  /** Passive one-shot: run `claude --resume <id> -p <message>` headless on the host. */
  async requestRun(sessionId: string, message: string): Promise<{ ok: boolean; reply?: string; error?: string }> {
    const d = await this.store.getDiscovered(sessionId);
    if (!d) return { ok: false, error: "unknown session" };
    const cmd = await this.enqueueAndWait(d.hostId, "passive_run", { sessionId, cwd: d.cwd, message });
    if (!cmd || cmd.status !== "done") return { ok: false, error: "timed out waiting for the host agent" };
    return (cmd.result ?? { ok: false, error: "no result" }) as { ok: boolean; reply?: string; error?: string };
  }

  /** Fetch a discovered session's transcript tail from its host. */
  async requestHistory(sessionId: string): Promise<{ ok: boolean; messages?: unknown[]; error?: string }> {
    const d = await this.store.getDiscovered(sessionId);
    if (!d) return { ok: false, error: "unknown session" };
    const cmd = await this.enqueueAndWait(d.hostId, "fetch_history", { sessionId, cwd: d.cwd });
    if (!cmd || cmd.status !== "done") return { ok: false, error: "timed out waiting for the host agent" };
    return (cmd.result ?? { ok: false, error: "no result" }) as { ok: boolean; messages?: unknown[]; error?: string };
  }
}
