import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Account } from "@rcw/shared";
import { ACCOUNT_STORE, type AccountStore } from "../domain/accounts/account-store.port";
import { AGENCY_MESSAGE_STORE, type AgencyAttachment, type AgencyMessageStore } from "../domain/agency/agency-message.port";

const ORG = "org";

/** Public GitHub activity for an agent. `days` is the real contribution calendar (the
 *  green-squares graph, one entry per day for ~the last year); `contribTotal` is its sum. */
export type GithubDay = { date: string; count: number };
export type GithubStat = {
  username: string; found: boolean; publicRepos: number; followers: number;
  commits: number; prs: number; issues: number; reviews: number; activeRepos: number;
  contribTotal: number; days: GithubDay[];
};
const emptyGh = (username = ""): GithubStat => ({ username, found: false, publicRepos: 0, followers: 0, commits: 0, prs: 0, issues: 0, reviews: 0, activeRepos: 0, contribTotal: 0, days: [] });

/** Parse GitHub's public contributions calendar HTML → daily counts. The page renders a
 *  grid of <td class="ContributionCalendar-day" data-date=".." id=".."> cells whose count
 *  lives in a matching <tool-tip for="..">N contributions on ..</tool-tip>. */
function parseContributions(html: string): GithubDay[] {
  const idCount = new Map<string, number>();
  const tipRe = /<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g;
  for (let m = tipRe.exec(html); m; m = tipRe.exec(html)) {
    const text = m[2].trim();
    const n = /^no contributions/i.test(text) ? 0 : parseInt(text.replace(/,/g, ""), 10);
    idCount.set(m[1], Number.isFinite(n) ? n : 0);
  }
  const days: GithubDay[] = [];
  const tdRe = /<td\b[^>]*class="[^"]*ContributionCalendar-day[^"]*"[^>]*>/g;
  for (let m = tdRe.exec(html); m; m = tdRe.exec(html)) {
    const tag = m[0];
    const date = /data-date="([^"]+)"/.exec(tag)?.[1];
    if (!date) continue;
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const dc = /data-count="(\d+)"/.exec(tag)?.[1]; // some renderings still carry data-count
    const count = dc != null ? parseInt(dc, 10) : (id ? idCount.get(id) ?? 0 : 0);
    days.push({ date, count });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

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

  // GitHub public stats are cached ~1h per username (keeps us well under GitHub's
  // unauthenticated 60 req/hr/IP limit — a roster refresh costs one fetch-set per agent
  // per hour). On error we fall back to the last good value rather than blanking.
  private ghCache = new Map<string, { at: number; data: GithubStat }>();
  private static readonly GH_TTL_MS = 60 * 60_000;
  async githubStats(username: string): Promise<GithubStat> {
    const u = (username ?? "").trim();
    if (!u) return emptyGh();
    const key = u.toLowerCase();
    const hit = this.ghCache.get(key);
    if (hit && Date.now() - hit.at < AgencyService.GH_TTL_MS) return hit.data;
    try {
      // A GITHUB_TOKEN (classic PAT, read-only is fine) lifts the API from 60→5000 req/hr,
      // avoiding the shared-IP rate limit that otherwise 403s the /users + /events calls.
      const token = process.env.GITHUB_TOKEN;
      const headers: Record<string, string> = { "User-Agent": "yitec-cowork", Accept: "application/vnd.github+json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const [uRes, eRes, cRes] = await Promise.all([
        fetch(`https://api.github.com/users/${encodeURIComponent(u)}`, { headers }),
        fetch(`https://api.github.com/users/${encodeURIComponent(u)}/events/public?per_page=100`, { headers }),
        // The real contribution calendar (green squares) — an unauthenticated HTML fragment
        // with a SEPARATE, far higher rate limit than the JSON API.
        fetch(`https://github.com/users/${encodeURIComponent(u)}/contributions`, { headers: { "User-Agent": "yitec-cowork", "X-Requested-With": "XMLHttpRequest" } }),
      ]);
      const prof = uRes.ok ? ((await uRes.json()) as { public_repos?: number; followers?: number }) : {};
      const days = cRes.ok ? parseContributions(await cRes.text()) : [];
      const contribTotal = days.reduce((n, d) => n + d.count, 0);
      const events = eRes.ok ? ((await eRes.json()) as Array<{ type?: string; repo?: { name?: string }; payload?: { action?: string; commits?: unknown[]; size?: number; distinct_size?: number } }>) : [];
      let commits = 0, prs = 0, issues = 0, reviews = 0;
      const repos = new Set<string>();
      for (const ev of Array.isArray(events) ? events : []) {
        if (ev.repo?.name) repos.add(ev.repo.name);
        if (ev.type === "PushEvent") {
          // GitHub's PUBLIC events feed sometimes omits size/commits — count each push
          // as at least 1 so real activity isn't reported as zero.
          commits += ev.payload?.size ?? ev.payload?.distinct_size ?? ev.payload?.commits?.length ?? 1;
        }
        else if (ev.type === "PullRequestEvent" && ev.payload?.action === "opened") prs++;
        else if (ev.type === "IssuesEvent" && ev.payload?.action === "opened") issues++;
        else if (ev.type === "PullRequestReviewEvent") reviews++;
      }
      // "found" if EITHER the API succeeded OR we parsed a real contribution calendar —
      // so a rate-limited /users call (403) no longer hides the heatmap.
      const data: GithubStat = {
        username: u, found: uRes.ok || days.length > 0, publicRepos: prof.public_repos ?? 0, followers: prof.followers ?? 0,
        commits, prs, issues, reviews, activeRepos: repos.size,
        contribTotal, days,
      };
      // Only cache a genuinely useful result; if this fetch found nothing but we have a
      // prior good value (e.g. transient rate-limit), keep serving the old one.
      if (data.found || !hit) this.ghCache.set(key, { at: Date.now(), data });
      return data.found ? data : (hit?.data ?? data);
    } catch {
      return hit?.data ?? emptyGh(u);
    }
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
