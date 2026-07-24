import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Account } from "@rcw/shared";
import { ACCOUNT_STORE, type AccountStore } from "../domain/accounts/account-store.port";
import { AGENCY_MESSAGE_STORE, type AgencyAttachment, type AgencyMessageStore } from "../domain/agency/agency-message.port";

const ORG = "org";

/** Enriched message for the client: the raw record + the author's public identity. */
export type AgencyMessageView = {
  id: string;
  channel: string;
  body: string;
  attachments: AgencyAttachment[];
  createdAt: Date;
  from: { accountId: string; username: string; displayName: string; photo: string | null };
  toAccountId: string | null;
};

/** DM thread summary for the inbox: the other agent + when it last saw traffic. */
export type AgencyThreadView = {
  channel: string;
  other: { accountId: string; username: string; displayName: string; photo: string | null };
  lastAt: Date;
};

/**
 * Agency messaging: the organisation-wide IRC channel and agent-to-agent DMs. DM
 * threads are keyed by a stable sorted-pair channel so both participants resolve the
 * same thread. Messages are enriched with the author's public profile (no PATs/hashes).
 */
@Injectable()
export class AgencyService {
  constructor(
    @Inject(AGENCY_MESSAGE_STORE) private readonly store: AgencyMessageStore,
    @Inject(ACCOUNT_STORE) private readonly accounts: AccountStore,
  ) {}

  /** Stable DM channel id for a pair of accounts (order-independent). */
  dmChannel(a: string, b: string): string {
    return "dm:" + [a, b].sort().join(":");
  }

  async postOrg(from: Account, body: string, attachments: AgencyAttachment[] = []): Promise<AgencyMessageView> {
    return this.enrichOne(await this.persist(ORG, from.id, null, body, attachments));
  }

  async listOrg(afterId?: string): Promise<AgencyMessageView[]> {
    return this.enrich(await this.store.list(ORG, { afterId }));
  }

  async postDm(from: Account, toAccountId: string, body: string, attachments: AgencyAttachment[] = []): Promise<AgencyMessageView> {
    if (toAccountId === from.id) throw new BadRequestException("cannot DM yourself");
    if (!(await this.accounts.findById(toAccountId))) throw new NotFoundException("recipient not found");
    const channel = this.dmChannel(from.id, toAccountId);
    return this.enrichOne(await this.persist(channel, from.id, toAccountId, body, attachments));
  }

  async listDm(me: Account, otherId: string, afterId?: string): Promise<AgencyMessageView[]> {
    if (!(await this.accounts.findById(otherId))) throw new NotFoundException("agent not found");
    const channel = this.dmChannel(me.id, otherId);
    return this.enrich(await this.store.list(channel, { afterId }));
  }

  async threads(me: Account): Promise<AgencyThreadView[]> {
    const threads = await this.store.threadsFor(me.id);
    const byId = await this.accountMap();
    return threads.map((t) => ({
      channel: t.channel,
      other: pub(byId.get(t.otherAccountId), t.otherAccountId),
      lastAt: t.lastAt,
    }));
  }

  private async persist(channel: string, from: string, to: string | null, body: string, attachments: AgencyAttachment[]) {
    const text = (body ?? "").trim();
    if (!text && attachments.length === 0) throw new BadRequestException("empty message");
    if (text.length > 4000) throw new BadRequestException("message too long");
    return this.store.post({
      id: randomUUID(), channel, fromAccount: from, toAccount: to,
      body: text.slice(0, 4000), attachments: attachments.slice(0, 10), createdAt: new Date(),
    });
  }

  private async accountMap(): Promise<Map<string, Account>> {
    return new Map((await this.accounts.list()).map((a) => [a.id, a]));
  }

  private async enrich(recs: Awaited<ReturnType<AgencyMessageStore["list"]>>): Promise<AgencyMessageView[]> {
    const byId = await this.accountMap();
    return recs.map((r) => view(r, byId.get(r.fromAccount)));
  }

  private async enrichOne(rec: Awaited<ReturnType<AgencyMessageStore["post"]>>): Promise<AgencyMessageView> {
    const acct = await this.accounts.findById(rec.fromAccount);
    return view(rec, acct ?? undefined);
  }
}

function pub(a: Account | undefined, fallbackId: string) {
  return {
    accountId: a?.id ?? fallbackId,
    username: a?.username ?? "unknown",
    displayName: a?.displayName ?? a?.username ?? "Unknown agent",
    photo: a?.photo ?? null,
  };
}

function view(rec: { id: string; channel: string; fromAccount: string; toAccount: string | null; body: string; attachments: AgencyAttachment[]; createdAt: Date }, a: Account | undefined): AgencyMessageView {
  return {
    id: rec.id, channel: rec.channel, body: rec.body, attachments: rec.attachments,
    createdAt: rec.createdAt, toAccountId: rec.toAccount, from: pub(a, rec.fromAccount),
  };
}
