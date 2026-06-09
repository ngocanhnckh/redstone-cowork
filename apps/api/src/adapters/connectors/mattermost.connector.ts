import type { IngestedEvent } from "@rcw/shared";
import type { Connector, ConnectorConfig, PullResult } from "../../domain/integrations/connector.port";

/**
 * Mattermost connector — PAT auth. Pulls posts that mention the user (and DMs)
 * since the cursor via the search API, normalizing into unified events.
 */
export class MattermostConnector implements Connector {
  readonly kind = "mattermost" as const;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private headers(token: string) {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  async validate(cfg: ConnectorConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.fetchImpl(`${cfg.endpoint.replace(/\/$/, "")}/api/v4/users/me`, {
        headers: this.headers(cfg.token),
      });
      if (!res.ok) return { ok: false, error: `Mattermost responded ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "request failed" };
    }
  }

  async pull(cfg: ConnectorConfig, cursor: Record<string, unknown>): Promise<PullResult> {
    const base = cfg.endpoint.replace(/\/$/, "");
    const since = typeof cursor.lastCreateAt === "number" ? cursor.lastCreateAt : 0;

    // Resolve the current user so we can search for their mentions.
    const meRes = await this.fetchImpl(`${base}/api/v4/users/me`, { headers: this.headers(cfg.token) });
    if (!meRes.ok) throw new Error(`Mattermost me ${meRes.status}`);
    const me = (await meRes.json()) as { id: string; username: string };

    const searchRes = await this.fetchImpl(`${base}/api/v4/users/${me.id}/posts/search`, {
      method: "POST",
      headers: this.headers(cfg.token),
      body: JSON.stringify({ terms: `@${me.username}`, is_or_search: true }),
    });
    if (!searchRes.ok) throw new Error(`Mattermost search ${searchRes.status}`);
    const data = (await searchRes.json()) as { order?: string[]; posts?: Record<string, MmPost> };

    const events: IngestedEvent[] = [];
    let maxCreate = since;
    for (const id of data.order ?? []) {
      const p = data.posts?.[id];
      if (!p || p.create_at <= since) continue;
      events.push({
        source: "mattermost",
        sourceId: p.id,
        type: "mattermost.mention",
        occurredAt: new Date(p.create_at),
        actor: p.user_id,
        payload: { message: p.message, channelId: p.channel_id },
        links: [],
      });
      if (p.create_at > maxCreate) maxCreate = p.create_at;
    }
    return { events, cursor: { lastCreateAt: maxCreate } };
  }
}

type MmPost = { id: string; create_at: number; message: string; user_id: string; channel_id: string };
