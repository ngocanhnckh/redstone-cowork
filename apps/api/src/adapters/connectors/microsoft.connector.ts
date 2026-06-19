import type { IngestedEvent } from "@rcw/shared";
import type { Connector, ConnectorConfig, PullResult } from "../../domain/integrations/connector.port";

// Common endpoint so a single app works for both personal (@outlook.com) and
// work/school (M365) mailboxes — the audience was set to AzureADandPersonalMicrosoftAccount.
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

export type MicrosoftConnectorDeps = {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
};

/**
 * Microsoft connector — OAuth refresh-token model, same shape as the Google one.
 * The stored secret (`cfg.token`) is a long-lived **refresh token**; every call
 * first mints a short-lived access token. One grant covers both Outlook mail and
 * Calendar via Microsoft Graph, normalized into `outlook.message`/`outlook.event`.
 */
export class MicrosoftConnector implements Connector {
  readonly kind = "microsoft" as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly deps: MicrosoftConnectorDeps) {
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
    if (!res.ok) throw new Error(`Microsoft token exchange ${res.status}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("Microsoft token exchange returned no access_token");
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

    // Each sub-pull is isolated: a mail outage must not block calendar ingestion
    // (and vice-versa). On failure we keep that source's prior cursor slice.
    const mailReceivedMs = typeof cursor.mailReceivedMs === "number" ? cursor.mailReceivedMs : 0;
    let nextMailMs = mailReceivedMs;
    try {
      const mail = await this.pullMail(headers, mailReceivedMs);
      events.push(...mail.events);
      nextMailMs = mail.maxReceivedMs;
    } catch {
      // keep prior cursor; surfaced via connection status on the next clean sync
    }

    const eventsModifiedMin = typeof cursor.eventsModifiedMin === "string" ? cursor.eventsModifiedMin : null;
    let nextModifiedMin = eventsModifiedMin;
    try {
      const cal = await this.pullCalendar(headers, eventsModifiedMin);
      events.push(...cal.events);
      nextModifiedMin = cal.maxModified ?? eventsModifiedMin;
    } catch {
      // keep prior cursor
    }

    return { events, cursor: { mailReceivedMs: nextMailMs, eventsModifiedMin: nextModifiedMin } };
  }

  private async pullMail(
    headers: Record<string, string>,
    since: number,
  ): Promise<{ events: IngestedEvent[]; maxReceivedMs: number }> {
    const query =
      "$top=15&$select=subject,from,receivedDateTime,bodyPreview,webLink&$orderby=receivedDateTime%20desc";
    const res = await this.fetchImpl(`${GRAPH}/me/messages?${query}`, { headers });
    if (!res.ok) throw new Error(`Graph mail list ${res.status}`);
    const data = (await res.json()) as { value?: GraphMessage[] };

    const events: IngestedEvent[] = [];
    let maxReceivedMs = since;
    for (const msg of data.value ?? []) {
      const receivedMs = msg.receivedDateTime ? Date.parse(msg.receivedDateTime) : 0;
      if (receivedMs <= since) continue;
      const from = msg.from?.emailAddress?.address ?? null;
      events.push({
        source: "microsoft",
        sourceId: msg.id,
        type: "outlook.message",
        occurredAt: new Date(receivedMs || Date.now()),
        actor: from,
        payload: { subject: msg.subject ?? null, from, snippet: msg.bodyPreview ?? null },
        links: msg.webLink ? [{ rel: "self", href: msg.webLink }] : [],
      });
      if (receivedMs > maxReceivedMs) maxReceivedMs = receivedMs;
    }
    return { events, maxReceivedMs };
  }

  private async pullCalendar(
    headers: Record<string, string>,
    modifiedMin: string | null,
  ): Promise<{ events: IngestedEvent[]; maxModified: string | null }> {
    const query =
      "$top=25&$select=subject,start,end,organizer,lastModifiedDateTime,webLink&$orderby=lastModifiedDateTime%20desc";
    const res = await this.fetchImpl(`${GRAPH}/me/events?${query}`, { headers });
    if (!res.ok) throw new Error(`Graph calendar list ${res.status}`);
    const data = (await res.json()) as { value?: GraphEvent[] };

    const events: IngestedEvent[] = [];
    let maxModified = modifiedMin;
    for (const ev of data.value ?? []) {
      const modified = ev.lastModifiedDateTime ?? new Date().toISOString();
      if (modifiedMin && modified <= modifiedMin) continue;
      events.push({
        source: "microsoft",
        sourceId: ev.id,
        type: "outlook.event",
        occurredAt: new Date(modified),
        actor: ev.organizer?.emailAddress?.address ?? null,
        payload: {
          summary: ev.subject ?? null,
          start: ev.start?.dateTime ?? null,
          end: ev.end?.dateTime ?? null,
        },
        links: ev.webLink ? [{ rel: "self", href: ev.webLink }] : [],
      });
      if (!maxModified || modified > maxModified) maxModified = modified;
    }
    return { events, maxModified };
  }
}

type GraphMessage = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
};

type GraphEvent = {
  id: string;
  subject?: string;
  lastModifiedDateTime?: string;
  webLink?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
};
