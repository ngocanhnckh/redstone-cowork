import type { Config } from "./config";

const json = (token: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
});

export class ApiClient {
  constructor(private readonly cfg: Config) {}

  private async req(
    path: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    return fetch(`${this.cfg.serverUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** true = known session (touched), false = unknown */
  async heartbeat(id: string): Promise<boolean> {
    const r = await this.req(
      `/sessions/${encodeURIComponent(id)}/heartbeat`,
      { method: "POST", headers: json(this.cfg.token) },
      2000
    );
    if (r.status === 404) return false;
    if (!r.ok) throw new Error(`heartbeat ${r.status}`);
    return true;
  }

  async attach(s: {
    id: string;
    machine: string;
    cwd: string;
    gitBranch: string | null;
    wrapperId: string | null;
    permissionMode: string | null;
    autoModeEnabled: boolean;
  }): Promise<void> {
    const r = await this.req(
      "/sessions",
      {
        method: "POST",
        headers: json(this.cfg.token),
        body: JSON.stringify(s),
      },
      3000
    );
    if (!r.ok) throw new Error(`attach ${r.status}`);
  }

  async createDecision(d: object): Promise<{ id: string }> {
    const r = await this.req(
      "/decisions",
      {
        method: "POST",
        headers: json(this.cfg.token),
        body: JSON.stringify(d),
      },
      3000
    );
    if (!r.ok) throw new Error(`createDecision ${r.status}`);
    return r.json();
  }

  /** POST /sessions/:id/resolve-local — fires and resolves (≤2s timeout). */
  async resolveLocal(sessionId: string): Promise<void> {
    await this.req(
      `/sessions/${encodeURIComponent(sessionId)}/resolve-local`,
      { method: "POST", headers: json(this.cfg.token) },
      2000
    );
    // Errors are silently swallowed by the handler's outer try/catch
  }

  async sessionByWrapper(wrapperId: string): Promise<{ id: string } | null> {
    const r = await this.req(
      `/sessions/by-wrapper/${encodeURIComponent(wrapperId)}`,
      { headers: json(this.cfg.token) },
      3000
    );
    return r.ok ? r.json() : null;
  }

  /** GET /sessions/by-wrapper/:wrapperId — the full session object (has `.id`). */
  async getByWrapper(wrapperId: string): Promise<{ id: string } | null> {
    return this.sessionByWrapper(wrapperId);
  }

  async deliveries(
    wrapperId: string,
    timeoutMs: number
  ): Promise<Array<Record<string, unknown>>> {
    const r = await this.req(
      `/sessions/by-wrapper/${encodeURIComponent(wrapperId)}/deliveries?timeoutMs=${timeoutMs}`,
      { headers: json(this.cfg.token) },
      timeoutMs + 5000
    );
    return r.status === 200 ? r.json() : [];
  }

  async markDelivered(id: string): Promise<void> {
    await this.req(
      `/decisions/${encodeURIComponent(id)}/delivered`,
      { method: "POST", headers: json(this.cfg.token) },
      3000
    );
  }

  async pushState(sessionId: string, patch: { latestAnswer?: string | null; transcript?: Array<{ role: "user" | "assistant"; text: string }>; todos?: Array<{ text: string; status: "pending" | "in_progress" | "completed" }>; working?: boolean; contextTokens?: number | null; model?: string | null; tokensInput?: number; tokensOutput?: number }): Promise<void> {
    await this.req(`/sessions/${encodeURIComponent(sessionId)}/state`, { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(patch) }, 3000);
  }

  // ---- Host agent (session inventory) ----

  async registerHost(h: { hostId: string; machine: string; user: string | null; os: string | null; address?: string | null; sshPort?: number | null }): Promise<void> {
    const r = await this.req("/hosts", { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(h) }, 5000);
    if (!r.ok) throw new Error(`registerHost ${r.status}`);
  }

  async reportInventory(hostId: string, report: { machine: string; sessions: Array<Record<string, unknown>> }): Promise<void> {
    const r = await this.req(`/hosts/${encodeURIComponent(hostId)}/inventory`, { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(report) }, 15000);
    if (!r.ok) throw new Error(`reportInventory ${r.status}`);
  }

  async reportTelemetry(hostId: string, sample: Record<string, unknown>): Promise<void> {
    await this.req(`/hosts/${encodeURIComponent(hostId)}/telemetry`, { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(sample) }, 8000).catch(() => {});
  }

  async reportDocker(hostId: string, snapshot: Record<string, unknown>): Promise<void> {
    await this.req(`/hosts/${encodeURIComponent(hostId)}/docker`, { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(snapshot) }, 8000).catch(() => {});
  }

  async reportCaps(hostId: string, snapshot: Record<string, unknown>): Promise<void> {
    await this.req(`/hosts/${encodeURIComponent(hostId)}/caps`, { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(snapshot) }, 8000).catch(() => {});
  }

  /** Upload a skill's full contents in response to an upload_skill command. */
  async uploadSkillContent(hostId: string, content: Record<string, unknown>): Promise<void> {
    const r = await this.req(`/hosts/${encodeURIComponent(hostId)}/skills`, { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(content) }, 15000);
    if (!r.ok) throw new Error(`uploadSkillContent ${r.status}`);
  }

  async hostCommands(hostId: string, timeoutMs: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.req(`/hosts/${encodeURIComponent(hostId)}/commands?timeoutMs=${timeoutMs}`, { headers: json(this.cfg.token) }, timeoutMs + 5000);
    return r.status === 200 ? r.json() : [];
  }

  async postCommandResult(hostId: string, cmdId: string, result: Record<string, unknown>): Promise<void> {
    await this.req(`/hosts/${encodeURIComponent(hostId)}/commands/${encodeURIComponent(cmdId)}/result`, { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(result) }, 5000);
  }

  /**
   * Provision a reverse-tunnel slot for this host. POSTs the agent's tunnel pubkey
   * and returns the relay coordinates, or `null` if the server isn't ready yet
   * (non-2xx / unreachable) so the caller can retry with backoff.
   */
  async provisionTunnel(
    hostId: string,
    pubkey: string
  ): Promise<{ relayHost: string; relayPort: number; tunnelUser: string; tunnelPort: number } | null> {
    try {
      const r = await this.req(
        `/hosts/${encodeURIComponent(hostId)}/tunnel`,
        { method: "POST", headers: json(this.cfg.token), body: JSON.stringify({ pubkey, kind: "agent" }) },
        8000
      );
      if (!r.ok) return null;
      const c = (await r.json()) as { relayHost?: string; relayPort?: number; tunnelUser?: string; tunnelPort?: number };
      if (!c.relayHost || !c.relayPort || !c.tunnelUser || !c.tunnelPort) return null;
      return { relayHost: c.relayHost, relayPort: c.relayPort, tunnelUser: c.tunnelUser, tunnelPort: c.tunnelPort };
    } catch {
      return null;
    }
  }

  // ---- Named Claude endpoint config profiles ----

  /** GET /configs — list profile names. Fail-safe: [] on any error. */
  async listConfigs(): Promise<string[]> {
    try {
      const r = await this.req("/configs", { headers: json(this.cfg.token) }, 5000);
      if (!r.ok) return [];
      const rows = (await r.json()) as Array<{ name?: string }>;
      return Array.isArray(rows) ? rows.map((x) => x.name).filter((n): n is string => typeof n === "string") : [];
    } catch {
      return [];
    }
  }

  /** GET /configs/:name — the profile's env map, or null if missing/unreachable. */
  async getConfig(name: string): Promise<{ name: string; env: Record<string, string> } | null> {
    try {
      const r = await this.req(`/configs/${encodeURIComponent(name)}`, { headers: json(this.cfg.token) }, 5000);
      if (!r.ok) return null;
      const body = (await r.json()) as { name?: string; env?: Record<string, string> };
      if (!body || typeof body.env !== "object" || body.env === null) return null;
      return { name: body.name ?? name, env: body.env };
    } catch {
      return null;
    }
  }

  /** PUT /configs/:name — save a profile. Returns false on any error. */
  async setConfig(name: string, env: Record<string, string>): Promise<boolean> {
    try {
      const r = await this.req(
        `/configs/${encodeURIComponent(name)}`,
        { method: "PUT", headers: json(this.cfg.token), body: JSON.stringify({ env }) },
        5000
      );
      return r.ok;
    } catch {
      return false;
    }
  }

  /** DELETE /configs/:name — remove a profile. Returns false on any error. */
  async deleteConfig(name: string): Promise<boolean> {
    try {
      const r = await this.req(`/configs/${encodeURIComponent(name)}`, { method: "DELETE", headers: json(this.cfg.token) }, 5000);
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Report the outcome of an ssh-authorize delivery back to the server. */
  async postSshResult(
    sessionId: string,
    result: { ok: boolean; user?: string; address?: string | null; port?: number; error?: string }
  ): Promise<void> {
    await this.req(
      `/sessions/${encodeURIComponent(sessionId)}/ssh-result`,
      { method: "POST", headers: json(this.cfg.token), body: JSON.stringify(result) },
      4000
    );
  }
}
