import type { BugReportRecord, BugReportStore } from "../../domain/reports/bug-report.port";

/** Test/dev store — no DB required (mirrors every other in-memory adapter). */
export class InMemoryBugReportStore implements BugReportStore {
  private readonly rows: BugReportRecord[] = [];

  async create(rec: BugReportRecord): Promise<BugReportRecord> {
    this.rows.unshift(rec);
    return rec;
  }

  async list(opts?: { limit?: number; status?: "open" | "closed" }): Promise<BugReportRecord[]> {
    const filtered = opts?.status ? this.rows.filter((r) => r.status === opts.status) : this.rows;
    return filtered.slice(0, opts?.limit ?? 100);
  }

  async setStatus(id: string, status: "open" | "closed"): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = status;
  }
}
