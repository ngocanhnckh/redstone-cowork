/** One problem report as submitted from the desktop app. `log` is the tail of the
 *  renderer/main logbook captured at submit time; `context` carries app version,
 *  platform and server URL. */
export type BugReportRecord = {
  id: string;
  accountId: string | null;
  username: string;
  message: string;
  log: string;
  context: Record<string, unknown>;
  status: "open" | "closed";
  createdAt: Date;
};

export interface BugReportStore {
  create(rec: BugReportRecord): Promise<BugReportRecord>;
  /** Newest first. Admin-facing triage list. */
  list(opts?: { limit?: number; status?: "open" | "closed" }): Promise<BugReportRecord[]>;
  setStatus(id: string, status: "open" | "closed"): Promise<void>;
}

export const BUG_REPORT_STORE = Symbol("BUG_REPORT_STORE");
