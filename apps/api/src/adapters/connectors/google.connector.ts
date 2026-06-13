import type { IngestedEvent } from "@rcw/shared";
import type { Connector, ConnectorConfig, PullResult } from "../../domain/integrations/connector.port";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleConnectorDeps = {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
};

/**
 * Google connector — OAuth refresh-token model. Unlike the PAT connectors, the
 * stored secret (`cfg.token`) is a long-lived **refresh token**; every call first
 * mints a short-lived access token via the token endpoint using the instance's
 * client credentials. One grant covers both Gmail and Calendar, so a single
 * connector pulls both, normalizing into `gmail.message` and `gcal.event` events.
 */
export class GoogleConnector implements Connector {
  readonly kind = "google" as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly deps: GoogleConnectorDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  /** Exchange the refresh token for an access token. Throws on a non-OK response. */
  private async accessToken(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.deps.clientId,
      client_secret: this.deps.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Google token exchange ${res.status}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("Google token exchange returned no access_token");
    return data.access_token;
  }

  async validate(cfg: ConnectorConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.accessToken(cfg.token);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "validation failed" };
    }
  }

  async pull(cfg: ConnectorConfig, cursor: Record<string, unknown>): Promise<PullResult> {
    const accessToken = await this.accessToken(cfg.token);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const events: IngestedEvent[] = [];

    // Each sub-pull is isolated: a Gmail outage must not block Calendar ingestion
    // (and vice-versa). On failure we keep that source's prior cursor slice.
    const lastInternalDate = typeof cursor.lastInternalDate === "number" ? cursor.lastInternalDate : 0;
    let nextInternalDate = lastInternalDate;
    try {
      const gmail = await this.pullGmail(headers, lastInternalDate);
      events.push(...gmail.events);
      nextInternalDate = gmail.maxInternalDate;
    } catch {
      // keep prior cursor; surfaced via connection status on the next clean sync
    }

    const eventsUpdatedMin = typeof cursor.eventsUpdatedMin === "string" ? cursor.eventsUpdatedMin : null;
    let nextUpdatedMin = eventsUpdatedMin;
    try {
      const cal = await this.pullCalendar(headers, eventsUpdatedMin);
      events.push(...cal.events);
      nextUpdatedMin = cal.maxUpdated ?? eventsUpdatedMin;
    } catch {
      // keep prior cursor
    }

    return { events, cursor: { lastInternalDate: nextInternalDate, eventsUpdatedMin: nextUpdatedMin } };
  }

  private async pullGmail(
    headers: Record<string, string>,
    since: number,
  ): Promise<{ events: IngestedEvent[]; maxInternalDate: number }> {
    const base = "https://www.googleapis.com/gmail/v1/users/me/messages";
    const listRes = await this.fetchImpl(`${base}?maxResults=15&q=${encodeURIComponent("newer_than:7d")}`, { headers });
    if (!listRes.ok) throw new Error(`Gmail list ${listRes.status}`);
    const list = (await listRes.json()) as { messages?: Array<{ id: string }> };

    const events: IngestedEvent[] = [];
    let maxInternalDate = since;
    for (const { id } of list.messages ?? []) {
      const msgRes = await this.fetchImpl(
        `${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers },
      );
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as GmailMessage;
      const internalDate = Number(msg.internalDate ?? 0);
      if (internalDate <= since) continue;
      const header = (name: string) =>
        msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
      events.push({
        source: "google",
        sourceId: msg.id,
        type: "gmail.message",
        occurredAt: new Date(internalDate || Date.now()),
        actor: header("From"),
        payload: { subject: header("Subject"), from: header("From"), snippet: msg.snippet ?? null },
        links: [{ rel: "self", href: `https://mail.google.com/mail/#all/${msg.id}` }],
      });
      if (internalDate > maxInternalDate) maxInternalDate = internalDate;
    }
    return { events, maxInternalDate };
  }

  private async pullCalendar(
    headers: Record<string, string>,
    updatedMin: string | null,
  ): Promise<{ events: IngestedEvent[]; maxUpdated: string | null }> {
    const params = new URLSearchParams({ singleEvents: "true", orderBy: "updated", maxResults: "25" });
    if (updatedMin) params.set("updatedMin", updatedMin);
    const res = await this.fetchImpl(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers },
    );
    if (!res.ok) throw new Error(`Calendar list ${res.status}`);
    const data = (await res.json()) as { items?: GCalEvent[] };

    const events: IngestedEvent[] = [];
    let maxUpdated = updatedMin;
    for (const ev of data.items ?? []) {
      const updated = ev.updated ?? new Date().toISOString();
      events.push({
        source: "google",
        sourceId: ev.id,
        type: "gcal.event",
        occurredAt: new Date(updated),
        actor: ev.organizer?.email ?? null,
        payload: {
          summary: ev.summary ?? null,
          status: ev.status ?? null,
          start: ev.start?.dateTime ?? ev.start?.date ?? null,
          end: ev.end?.dateTime ?? ev.end?.date ?? null,
        },
        links: ev.htmlLink ? [{ rel: "self", href: ev.htmlLink }] : [],
      });
      if (!maxUpdated || updated > maxUpdated) maxUpdated = updated;
    }
    return { events, maxUpdated };
  }
}

type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

type GCalEvent = {
  id: string;
  summary?: string;
  status?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string };
  htmlLink?: string;
};
