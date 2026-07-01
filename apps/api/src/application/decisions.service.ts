import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { NewDecisionSchema, ResolutionSchema, type Decision } from "@rcw/shared";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { DECISION_STORE, type DecisionStore } from "../domain/decisions/decision-store.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";
import { DecisionWaiters } from "./decision-waiters";
import { DeliveryWaiters } from "./delivery-waiters";
import { EventsBus } from "./events-bus";

@Injectable()
export class DecisionsService {
  constructor(
    @Inject(DECISION_STORE) private readonly store: DecisionStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    private readonly waiters: DecisionWaiters,
    private readonly deliveryWaiters: DeliveryWaiters,
    private readonly bus: EventsBus,
  ) {}

  // Passive cards (a finished-task ping, a notification) carry no action and only
  // the latest matters — keep at most one per session so the Situation Room stays
  // clean. A continued session reuses its id, so this dedupes across --continue too.
  private static readonly PASSIVE_KINDS = ["notification", "completion"];

  async create(input: unknown): Promise<Decision> {
    const parsed = NewDecisionSchema.parse(input);
    if (!(await this.sessions.get(parsed.sessionId))) throw new NotFoundException("unknown session");
    if (DecisionsService.PASSIVE_KINDS.includes(parsed.kind)) {
      await this.store.supersedePending(parsed.sessionId, DecisionsService.PASSIVE_KINDS, new Date());
    }
    const decision: Decision = {
      ...parsed, id: randomUUID(), status: "pending",
      createdAt: new Date(), resolvedAt: null, resolution: null, deliveredAt: null,
    };
    const stored = await this.store.create(decision);
    this.bus.emit({ type: "decision.created", payload: stored });
    return stored;
  }

  listPending() { return this.store.listPending(); }
  get(id: string) { return this.store.get(id); }
  countPendingBySession() { return this.store.countPendingBySession(); }
  oldestPendingAtBySession() { return this.store.oldestPendingAtBySession(); }

  async resolve(id: string, input: unknown): Promise<Decision> {
    const resolution = ResolutionSchema.parse(input);
    const resolved = await this.store.resolve(id, resolution, new Date());
    if (!resolved) {
      const existing = await this.store.get(id);
      if (!existing) throw new NotFoundException();
      throw new ConflictException("already resolved");
    }
    this.waiters.notify(resolved);
    this.deliveryWaiters.notify(resolved.sessionId);
    this.bus.emit({ type: "decision.resolved", payload: resolved });
    return resolved;
  }

  async await(id: string, timeoutMs: number): Promise<Decision | null> {
    const existing = await this.store.get(id);
    if (!existing) throw new NotFoundException();
    if (existing.status === "resolved") return existing;
    return this.waiters.wait(id, Math.min(timeoutMs, 30_000));
  }

  async instruct(sessionId: string, input: unknown): Promise<Decision> {
    const { text } = z.object({ text: z.string().min(1) }).parse(input);
    if (!(await this.sessions.get(sessionId))) throw new NotFoundException("unknown session");
    const now = new Date();
    const decision: Decision = {
      sessionId, kind: "instruction", title: text.slice(0, 120), body: {}, options: [],
      id: randomUUID(), status: "resolved", createdAt: now, resolvedAt: now,
      resolution: { choice: null, answers: null, custom: text }, deliveredAt: null,
    };
    const created = await this.store.create(decision);
    this.deliveryWaiters.notify(sessionId);
    this.bus.emit({ type: "decision.created", payload: created });
    return created;
  }

  /**
   * Interrupt Claude's current turn: create a resolved `interrupt` deliverable the
   * poller turns into an Escape (abort) plus, when `text` is given, a replacement
   * instruction typed once Claude is back at the prompt. Created resolved (like
   * `mode`) so it delivers immediately and never surfaces as a pending card.
   */
  async interrupt(sessionId: string, input: unknown): Promise<Decision> {
    const { text } = z.object({ text: z.string().optional() }).parse(input);
    if (!(await this.sessions.get(sessionId))) throw new NotFoundException("unknown session");
    const trimmed = text?.trim() || null;
    const now = new Date();
    const decision: Decision = {
      sessionId, kind: "interrupt",
      title: trimmed ? `Interrupt · ${trimmed.slice(0, 100)}` : "Interrupt",
      body: {}, options: [],
      id: randomUUID(), status: "resolved", createdAt: now, resolvedAt: now,
      resolution: { choice: null, answers: null, custom: trimmed }, deliveredAt: null,
    };
    const created = await this.store.create(decision);
    this.deliveryWaiters.notify(sessionId);
    this.bus.emit({ type: "decision.created", payload: created });
    return created;
  }

  /**
   * Ask the session's host (its running agent poller) to install `publicKey`
   * into the remote `~/.ssh/authorized_keys`. Created as a RESOLVED deliverable
   * (mirrors `switchMode`) so it is delivered to the poller but never surfaces
   * as a pending decision card. The poller acts on it and posts back an
   * ssh-result; it never types into the TUI.
   */
  async authorizeSsh(sessionId: string, publicKey: string): Promise<{ ok: true }> {
    if (!(await this.sessions.get(sessionId))) throw new NotFoundException("unknown session");
    const now = new Date();
    const decision: Decision = {
      sessionId, kind: "ssh-authorize", title: "Authorize SSH key",
      body: { publicKey }, options: [],
      id: randomUUID(), status: "resolved", createdAt: now, resolvedAt: now,
      resolution: { choice: null, answers: null, custom: null }, deliveredAt: null,
    };
    await this.store.create(decision);
    this.deliveryWaiters.notify(sessionId);
    this.bus.emit({ type: "session.updated", payload: { id: sessionId } });
    return { ok: true };
  }

  async deliveries(sessionId: string, timeoutMs: number): Promise<Decision[]> {
    const existing = await this.store.listUndelivered(sessionId);
    if (existing.length > 0) return existing;
    await this.deliveryWaiters.wait(sessionId, Math.min(timeoutMs, 30_000));
    return this.store.listUndelivered(sessionId);
  }

  markDelivered(id: string) { return this.store.markDelivered(id, new Date()); }
  resolveLocal(sessionId: string) { return this.store.resolveAllPendingLocal(sessionId, new Date()); }

  async switchMode(sessionId: string, target: string): Promise<{ switched: boolean; btabs: number; mode: string }> {
    const session = await this.sessions.get(sessionId);
    if (!session) throw new NotFoundException("unknown session");

    // Claude Code's full Shift+Tab permission-mode cycle. Auto mode is a standard
    // Claude feature (enabled per-account in settings or via --enable-auto-mode), so
    // we always offer it — no per-session gating, which made it falsely unavailable.
    const cycle = ["default", "acceptEdits", "plan", "auto"];

    if (!cycle.includes(target)) throw new BadRequestException("mode not available");

    const current =
      session.permissionMode && cycle.includes(session.permissionMode)
        ? session.permissionMode
        : "default";

    const n = (cycle.indexOf(target) - cycle.indexOf(current) + cycle.length) % cycle.length;

    if (n === 0) {
      await this.sessions.setPermissionMode(sessionId, target);
      return { switched: false, btabs: 0, mode: target };
    }

    const now = new Date();
    const decision: Decision = {
      sessionId, kind: "mode", title: `Switch to ${target} mode`,
      body: { btabs: n, target }, options: [],
      id: randomUUID(), status: "resolved", createdAt: now, resolvedAt: now,
      resolution: { choice: null, answers: null, custom: null }, deliveredAt: null,
    };
    await this.store.create(decision);
    await this.sessions.setPermissionMode(sessionId, target);
    this.deliveryWaiters.notify(sessionId);
    this.bus.emit({ type: "session.updated", payload: { id: sessionId } });
    return { switched: true, btabs: n, mode: target };
  }
}
