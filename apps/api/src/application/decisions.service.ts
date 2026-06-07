import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { NewDecisionSchema, ResolutionSchema, type Decision } from "@rcw/shared";
import { randomUUID } from "node:crypto";
import { DECISION_STORE, type DecisionStore } from "../domain/decisions/decision-store.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";
import { DecisionWaiters } from "./decision-waiters";
import { EventsBus } from "./events-bus";

@Injectable()
export class DecisionsService {
  constructor(
    @Inject(DECISION_STORE) private readonly store: DecisionStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    private readonly waiters: DecisionWaiters,
    private readonly bus: EventsBus,
  ) {}

  async create(input: unknown): Promise<Decision> {
    const parsed = NewDecisionSchema.parse(input);
    if (!(await this.sessions.get(parsed.sessionId))) throw new NotFoundException("unknown session");
    const decision: Decision = {
      ...parsed, id: randomUUID(), status: "pending",
      createdAt: new Date(), resolvedAt: null, resolution: null,
    };
    const stored = await this.store.create(decision);
    this.bus.emit({ type: "decision.created", payload: stored });
    return stored;
  }

  listPending() { return this.store.listPending(); }
  get(id: string) { return this.store.get(id); }
  countPendingBySession() { return this.store.countPendingBySession(); }

  async resolve(id: string, input: unknown): Promise<Decision> {
    const resolution = ResolutionSchema.parse(input);
    const resolved = await this.store.resolve(id, resolution, new Date());
    if (!resolved) {
      const existing = await this.store.get(id);
      if (!existing) throw new NotFoundException();
      throw new ConflictException("already resolved");
    }
    this.waiters.notify(resolved);
    this.bus.emit({ type: "decision.resolved", payload: resolved });
    return resolved;
  }

  async await(id: string, timeoutMs: number): Promise<Decision | null> {
    const existing = await this.store.get(id);
    if (!existing) throw new NotFoundException();
    if (existing.status === "resolved") return existing;
    return this.waiters.wait(id, Math.min(timeoutMs, 30_000));
  }
}
