import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { NewDecisionSchema, type Decision } from "@rcw/shared";
import { randomUUID } from "node:crypto";
import { DECISION_STORE, type DecisionStore } from "../domain/decisions/decision-store.port";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";

@Injectable()
export class DecisionsService {
  constructor(
    @Inject(DECISION_STORE) private readonly store: DecisionStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore
  ) {}

  async create(input: unknown): Promise<Decision> {
    const parsed = NewDecisionSchema.parse(input);
    if (!(await this.sessions.get(parsed.sessionId))) throw new NotFoundException("unknown session");
    const decision: Decision = {
      ...parsed, id: randomUUID(), status: "pending",
      createdAt: new Date(), resolvedAt: null, resolution: null,
    };
    return this.store.create(decision);
  }
  listPending() { return this.store.listPending(); }
  get(id: string) { return this.store.get(id); }
  countPendingBySession() { return this.store.countPendingBySession(); }
}
