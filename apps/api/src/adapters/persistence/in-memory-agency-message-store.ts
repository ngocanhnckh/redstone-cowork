import type { AgencyMessageRecord, AgencyMessageStore, AgencyThread } from "../../domain/agency/agency-message.port";

/** In-memory agency messages (tests / no-DB dev). Ordered by insertion. */
export class InMemoryAgencyMessageStore implements AgencyMessageStore {
  private readonly msgs: AgencyMessageRecord[] = [];

  async post(rec: AgencyMessageRecord): Promise<AgencyMessageRecord> {
    this.msgs.push(rec);
    return rec;
  }

  async list(channel: string, opts?: { limit?: number; afterId?: string }): Promise<AgencyMessageRecord[]> {
    let rows = this.msgs.filter((m) => m.channel === channel);
    if (opts?.afterId) {
      const idx = rows.findIndex((m) => m.id === opts.afterId);
      rows = idx >= 0 ? rows.slice(idx + 1) : rows;
    }
    const limit = opts?.limit ?? 200;
    return rows.slice(-limit);
  }

  async threadsFor(accountId: string): Promise<AgencyThread[]> {
    const latest = new Map<string, AgencyThread>();
    for (const m of this.msgs) {
      if (m.channel === "org" || (m.fromAccount !== accountId && m.toAccount !== accountId)) continue;
      const other = m.fromAccount === accountId ? m.toAccount : m.fromAccount;
      if (!other) continue;
      const cur = latest.get(m.channel);
      if (!cur || m.createdAt > cur.lastAt) latest.set(m.channel, { channel: m.channel, otherAccountId: other, lastAt: m.createdAt });
    }
    return [...latest.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  }
}
