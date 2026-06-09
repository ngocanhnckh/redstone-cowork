import type { Decision, Resolution } from "@rcw/shared";
import type { DecisionStore } from "../../domain/decisions/decision-store.port";

const DELIVERABLE_KINDS = new Set(["permission", "question", "instruction", "mode"]);

export class InMemoryDecisionStore implements DecisionStore {
  private decisions = new Map<string, Decision>();
  async create(d: Decision) { this.decisions.set(d.id, d); return d; }
  async get(id: string) { return this.decisions.get(id) ?? null; }
  async listPending() {
    return [...this.decisions.values()].filter((d) => d.status === "pending")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async resolve(id: string, resolution: Resolution, at: Date) {
    const d = this.decisions.get(id);
    if (!d || d.status !== "pending") return null;
    const resolved: Decision = { ...d, status: "resolved", resolution, resolvedAt: at };
    this.decisions.set(id, resolved);
    return resolved;
  }
  async countPendingBySession() {
    const counts: Record<string, number> = {};
    for (const d of this.decisions.values())
      if (d.status === "pending") counts[d.sessionId] = (counts[d.sessionId] ?? 0) + 1;
    return counts;
  }
  async listUndelivered(sessionId: string): Promise<Decision[]> {
    return [...this.decisions.values()].filter(
      (d) => d.sessionId === sessionId && d.status === "resolved" && d.deliveredAt === null && DELIVERABLE_KINDS.has(d.kind)
    ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async markDelivered(id: string, at: Date): Promise<void> {
    const d = this.decisions.get(id);
    if (d) this.decisions.set(id, { ...d, deliveredAt: at });
  }
  async resolveAllPendingLocal(sessionId: string, at: Date): Promise<number> {
    let count = 0;
    for (const d of this.decisions.values()) {
      if (d.sessionId === sessionId && d.status === "pending" && (d.kind === "permission" || d.kind === "question")) {
        this.decisions.set(d.id, {
          ...d,
          status: "resolved",
          resolution: { choice: "__local__", answers: null, custom: null },
          resolvedAt: at,
          deliveredAt: at,
        });
        count++;
      }
    }
    return count;
  }
  async supersedePending(sessionId: string, kinds: string[], at: Date): Promise<number> {
    const kindSet = new Set(kinds);
    let count = 0;
    for (const d of this.decisions.values()) {
      if (d.sessionId === sessionId && d.status === "pending" && kindSet.has(d.kind)) {
        this.decisions.set(d.id, {
          ...d,
          status: "resolved",
          resolution: { choice: "__superseded__", answers: null, custom: null },
          resolvedAt: at,
          deliveredAt: at,
        });
        count++;
      }
    }
    return count;
  }
}
