import type { Decision, Resolution } from "@rcw/shared";
import type { DecisionStore } from "../../domain/decisions/decision-store.port";

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
}
