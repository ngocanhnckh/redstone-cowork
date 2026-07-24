/** A file attached to an agency message. The blob lives in the API uploads dir; this is
 *  just the manifest the client renders/links. */
export type AgencyAttachment = { name: string; url: string; size: number; mime: string };

/** One agency message as persisted. `channel` is 'org' for the town square, or a
 *  sorted-pair 'dm:<a>:<b>' for a direct thread; `toAccount` is null on the org channel. */
export type AgencyMessageRecord = {
  id: string;
  channel: string;
  fromAccount: string;
  toAccount: string | null;
  body: string;
  attachments: AgencyAttachment[];
  createdAt: Date;
};

/** Recent DM thread summary for an inbox: the thread channel, the OTHER participant's
 *  account id, and when it last saw traffic. */
export type AgencyThread = { channel: string; otherAccountId: string; lastAt: Date };

export interface AgencyMessageStore {
  post(rec: AgencyMessageRecord): Promise<AgencyMessageRecord>;
  /** Messages in a channel, oldest→newest. `afterId` returns only messages newer than
   *  that id (for incremental polling); `limit` caps the initial fetch. */
  list(channel: string, opts?: { limit?: number; afterId?: string }): Promise<AgencyMessageRecord[]>;
  /** DM threads an account participates in (either sender or recipient), newest first. */
  threadsFor(accountId: string): Promise<AgencyThread[]>;
}

export const AGENCY_MESSAGE_STORE = Symbol("AGENCY_MESSAGE_STORE");
