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
}
