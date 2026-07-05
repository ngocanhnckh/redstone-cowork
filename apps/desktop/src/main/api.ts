import { getToken, getRefreshToken, loadConfig, updateTokens } from "./config";

let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);

export function setFetch(f: typeof fetch): void {
  fetchImpl = f;
}

const trimUrl = (u: string): string => u.replace(/\/$/, "");

function cfg(): { serverUrl: string; token: string } {
  const config = loadConfig();
  const token = getToken();
  if (!config?.serverUrl || !token) throw new Error("not configured");
  return { serverUrl: config.serverUrl, token };
}

/** Org mode only: swap the stored refresh token for a fresh access token. Returns it, or null. */
async function tryRefresh(serverUrl: string): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/redstone/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
    if (!j.access_token) return null;
    updateTokens(j.access_token, j.refresh_token);
    return j.access_token;
  } catch {
    return null;
  }
}

// Single-flight the refresh: many requests 401 at once when the access token
// expires (queue, telemetry, docker, decisions all fire together). Without this,
// each would POST /auth/redstone/refresh with the SAME refresh token; Redstone
// rotates refresh tokens on use, so only the first succeeds and the rest fail —
// and a racing updateTokens() write can persist a dead token, wedging auth until
// the user signs out. Sharing one in-flight promise means the token rotates once.
let refreshInFlight: Promise<string | null> | null = null;
function sharedRefresh(serverUrl: string): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = tryRefresh(serverUrl).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  const { serverUrl, token } = cfg();
  const call = (t: string) =>
    fetchImpl(serverUrl + path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...(init?.headers ?? {}) },
    });
  let res = await call(token);
  // Org access tokens expire (~24h) — refresh once and retry before failing.
  // sharedRefresh() dedupes concurrent 401s so the refresh token rotates only once.
  if (res.status === 401) {
    const fresh = await sharedRefresh(serverUrl);
    if (fresh) res = await call(fresh);
  }
  if (!res.ok) throw new Error(String(res.status));
  return res;
}

/** Public discovery so the login screen can decide whether to offer Redstone sign-in. */
export async function authConfig(serverUrl: string): Promise<{ redstone: boolean; issuer: string | null }> {
  try {
    const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/config`);
    if (!r.ok) return { redstone: false, issuer: null };
    return (await r.json()) as { redstone: boolean; issuer: string | null };
  } catch {
    return { redstone: false, issuer: null };
  }
}

/** Org sign-in: exchange Redstone username+password for tokens (caller persists them). */
export async function redstoneLogin(
  serverUrl: string,
  username: string,
  password: string,
): Promise<{ access_token: string; refresh_token: string | null; user: { username: string | null } | null }> {
  const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/redstone/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !j.access_token) {
    throw new Error(String(j.error_description ?? `Sign-in failed (HTTP ${r.status}).`));
  }
  return {
    access_token: String(j.access_token),
    refresh_token: j.refresh_token ? String(j.refresh_token) : null,
    user: (j.user as { username: string | null }) ?? null,
  };
}

export async function getSessions(): Promise<unknown[]> {
  return (await req("/sessions")).json();
}

export async function getQueue(): Promise<unknown[]> {
  return (await req("/sessions/queue")).json();
}

export async function getPendingDecisions(): Promise<unknown[]> {
  return (await req("/decisions")).json();
}

export async function resolveDecision(
  id: string,
  resolution: {
    choice?: string | null;
    answers?: Record<string, string | string[]> | null;
    custom?: string | null;
  }
): Promise<unknown> {
  return (
    await req(`/decisions/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify(resolution),
    })
  ).json();
}

export async function instruct(sessionId: string, text: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/instruct`, {
      method: "POST",
      body: JSON.stringify({ text }),
    })
  ).json();
}

export async function snooze(id: string, minutes: number): Promise<void> {
  await req(`/sessions/${id}/snooze`, {
    method: "POST",
    body: JSON.stringify({ minutes }),
  });
}

export async function pin(id: string, pinned: boolean): Promise<void> {
  await req(`/sessions/${id}/pin`, {
    method: "POST",
    body: JSON.stringify({ pinned }),
  });
}

/** Soft-close a stale/ghost session server-side; it then drops out of /sessions + /sessions/queue. */
export async function dismissSession(id: string): Promise<void> {
  await req(`/sessions/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
}

export async function interrupt(sessionId: string, text?: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/interrupt`, {
      method: "POST",
      body: JSON.stringify(text ? { text } : {}),
    })
  ).json();
}

export async function addUserTodo(sessionId: string, text: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/user-todos`, {
      method: "POST",
      body: JSON.stringify({ text }),
    })
  ).json();
}

export async function toggleUserTodo(sessionId: string, todoId: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/user-todos/${encodeURIComponent(todoId)}/toggle`, {
      method: "POST",
    })
  ).json();
}

export async function deleteUserTodo(sessionId: string, todoId: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/user-todos/${encodeURIComponent(todoId)}/delete`, {
      method: "POST",
    })
  ).json();
}

export async function listAccessKeys(): Promise<unknown[]> {
  return (await req("/access-keys")).json();
}
export async function createAccessKey(name: string, scope: "read" | "control"): Promise<unknown> {
  return (await req("/access-keys", { method: "POST", body: JSON.stringify({ name, scope }) })).json();
}
export async function revokeAccessKey(id: string): Promise<unknown> {
  return (await req(`/access-keys/${encodeURIComponent(id)}/revoke`, { method: "POST" })).json();
}

// Named Claude endpoint/model config profiles (server-stored, env encrypted at
// rest). `redstone --config="<name>" claude` injects a profile's env into the session.
export async function listClaudeConfigs(): Promise<unknown> {
  return (await req("/configs")).json();
}
export async function getClaudeConfig(name: string): Promise<unknown> {
  return (await req(`/configs/${encodeURIComponent(name)}`)).json();
}
export async function putClaudeConfig(name: string, env: Record<string, string>): Promise<unknown> {
  return (await req(`/configs/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ env }) })).json();
}
export async function deleteClaudeConfig(name: string): Promise<unknown> {
  return (await req(`/configs/${encodeURIComponent(name)}`, { method: "DELETE" })).json();
}

export async function getTelemetry(): Promise<unknown[]> {
  return (await req("/telemetry")).json();
}
export async function getDocker(): Promise<unknown[]> {
  return (await req("/telemetry/docker")).json();
}
export async function getCaps(): Promise<unknown[]> {
  return (await req("/telemetry/caps")).json();
}
export async function getHosts(): Promise<Array<{ id: string; machine: string; user: string | null; address: string | null; sshPort: number | null }>> {
  return (await req("/hosts")).json();
}

// ---- NAT'd-host SSH relay (reverse tunnel via cowork server) ----
export type TunnelCoordinates = {
  relayHost: string;
  relayPort: number;
  tunnelUser: string;
  tunnelPort: number;
};

/** Cockpit: fetch a host's relay coordinates (404 if the host has no tunnel provisioned). */
export async function getHostTunnel(hostId: string): Promise<TunnelCoordinates> {
  return (await req(`/hosts/${encodeURIComponent(hostId)}/tunnel`)).json();
}

/** Cockpit: register this desktop's jump pubkey on the relay (idempotent server-side). */
export async function registerCockpitKey(pubkey: string, label: string): Promise<void> {
  await req("/tunnel/cockpit-key", { method: "POST", body: JSON.stringify({ pubkey, label }) });
}

export async function getInventory(): Promise<unknown> {
  return (await req("/inventory")).json();
}
export async function inventoryHistory(id: string): Promise<unknown> {
  return (await req(`/inventory/${encodeURIComponent(id)}/history`)).json();
}
export async function inventoryRun(id: string, message: string): Promise<unknown> {
  return (await req(`/inventory/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify({ message }) })).json();
}
export async function inventoryAddTag(id: string, tag: string): Promise<unknown> {
  return (await req(`/inventory/${encodeURIComponent(id)}/tags`, { method: "POST", body: JSON.stringify({ tag }) })).json();
}
export async function inventoryRemoveTag(id: string, tag: string): Promise<unknown> {
  return (await req(`/inventory/${encodeURIComponent(id)}/tags/remove`, { method: "POST", body: JSON.stringify({ tag }) })).json();
}

export async function addTag(sessionId: string, tag: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/tags`, {
      method: "POST",
      body: JSON.stringify({ tag }),
    })
  ).json();
}

export async function removeTag(sessionId: string, tag: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/tags/remove`, {
      method: "POST",
      body: JSON.stringify({ tag }),
    })
  ).json();
}

export async function switchMode(sessionId: string, mode: string): Promise<unknown> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/mode`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    })
  ).json();
}

export async function authorizeSsh(
  sessionId: string,
  publicKey: string
): Promise<{ ok: true }> {
  return (
    await req(`/sessions/${encodeURIComponent(sessionId)}/ssh-authorize`, {
      method: "POST",
      body: JSON.stringify({ publicKey }),
    })
  ).json();
}

export type SshResult = {
  ok: boolean;
  user?: string;
  address?: string | null;
  port?: number;
  error?: string;
  at: string;
};

// ---- LLM assistant ----
export type LlmModelInfo = { id: string; label: string; model: string; kind: "preset" | "custom" };

export async function llmModels(): Promise<LlmModelInfo[]> {
  const json = (await (await req("/llm/models")).json()) as { models: LlmModelInfo[] };
  return json.models ?? [];
}

export async function llmAssist(a: {
  sessionId: string;
  kind: "chat" | "optimize" | "summarize";
  modelId?: string;
  input?: string;
}): Promise<string> {
  const json = (await (
    await req("/llm/assist", { method: "POST", body: JSON.stringify(a) })
  ).json()) as { text: string };
  return json.text;
}

export async function llmChat(a: {
  modelId: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}): Promise<string> {
  const json = (await (
    await req("/llm/chat", { method: "POST", body: JSON.stringify(a) })
  ).json()) as { text: string };
  return json.text;
}

export async function addLlmEndpoint(a: {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  maxInputTokens?: number;
  role?: "text" | "flash" | "vision";
}): Promise<LlmModelInfo> {
  return (await (await req("/llm/endpoints", { method: "POST", body: JSON.stringify(a) })).json()) as LlmModelInfo;
}

export async function deleteLlmEndpoint(id: string): Promise<void> {
  await req(`/llm/endpoints/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type AgentStep = { tool: string; args: string; result: string };

export async function agentEnabled(): Promise<boolean> {
  try {
    const j = (await (await req("/llm/agent/enabled")).json()) as { enabled: boolean };
    return !!j.enabled;
  } catch {
    return false;
  }
}

export async function llmAgent(a: { sessionId: string; input: string; modelId?: string }): Promise<{ text: string; steps: AgentStep[] }> {
  return (await (await req("/llm/agent", { method: "POST", body: JSON.stringify(a) })).json()) as { text: string; steps: AgentStep[] };
}

export async function getSshResult(sessionId: string): Promise<SshResult | null> {
  const res = await req(`/sessions/${encodeURIComponent(sessionId)}/ssh-result`);
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.at === "string") {
      return parsed as SshResult;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseSseBlock(
  block: string
): { type: string; payload: unknown } | null {
  try {
    const lines = block.split("\n");
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const json = line.slice("data:".length).trim();
        const parsed = JSON.parse(json);
        if (typeof parsed?.type === "string") {
          return { type: parsed.type, payload: parsed.payload ?? null };
        }
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function startStream(
  onEvent: (e: { type: string; payload: unknown }) => void
): () => void {
  let stopped = false;
  let backoff = 1000;
  const backoffSteps = [1000, 2000, 5000];
  let backoffIdx = 0;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  // Poll fallback every 3000ms
  const pollInterval = setInterval(() => {
    if (!stopped) onEvent({ type: "poll.tick", payload: null });
  }, 3000);

  async function connect(): Promise<void> {
    if (stopped) return;
    try {
      const { serverUrl, token } = cfg();
      const res = await fetchImpl(`${serverUrl}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.body) throw new Error("no body");

      // Reset backoff on successful connection
      backoffIdx = 0;
      backoff = backoffSteps[0];

      const reader = res.body.getReader();
      activeReader = reader;
      const dec = new TextDecoder();
      let buffer = "";

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          const parsed = parseSseBlock(part);
          if (parsed) onEvent(parsed);
        }
      }
    } catch {
      // ignore errors, reconnect below
    } finally {
      activeReader = null;
    }

    if (!stopped) {
      backoff = backoffSteps[Math.min(backoffIdx, backoffSteps.length - 1)];
      backoffIdx = Math.min(backoffIdx + 1, backoffSteps.length - 1);
      setTimeout(connect, backoff);
    }
  }

  connect();

  return () => {
    stopped = true;
    clearInterval(pollInterval);
    activeReader?.cancel().catch(() => {/* ignore cancel errors */});
    activeReader = null;
  };
}
