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

/** Public discovery so the login screen can decide which sign-in options to offer. */
export async function authConfig(
  serverUrl: string,
): Promise<{ redstone: boolean; issuer: string | null; accounts?: boolean; orgName?: string | null }> {
  try {
    const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/config`);
    if (!r.ok) return { redstone: false, issuer: null };
    return (await r.json()) as { redstone: boolean; issuer: string | null; accounts?: boolean; orgName?: string | null };
  } catch {
    return { redstone: false, issuer: null };
  }
}

/** Enterprise employee sign-in: username+password → rcwa_ bearer + account profile. */
export async function accountLogin(
  serverUrl: string,
  username: string,
  password: string,
  device: string,
): Promise<{ token: string; account: { username: string; displayName: string; role: string } }> {
  const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, device }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !j.token) {
    throw new Error(String((j as { error_description?: string }).error_description ?? `Sign-in failed (HTTP ${r.status}).`));
  }
  return j as { token: string; account: { username: string; displayName: string; role: string } };
}

export async function accountsAnalytics(): Promise<unknown[]> { return (await req("/accounts/analytics")).json(); }
export async function accountSessions(id: string): Promise<unknown[]> { return (await req(`/accounts/${encodeURIComponent(id)}/sessions`)).json(); }

/** ——— Server registry ——— */
export async function serversList(): Promise<unknown[]> { return (await req("/servers")).json(); }
export async function serverCreate(input: unknown): Promise<unknown> { return (await req("/servers", { method: "POST", body: JSON.stringify(input) })).json(); }
export async function serverUpdate(id: string, patch: unknown): Promise<unknown> { return (await req(`/servers/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(patch) })).json(); }
export async function serverDelete(id: string): Promise<unknown> { return (await req(`/servers/${encodeURIComponent(id)}`, { method: "DELETE" })).json(); }
export async function serverGrant(id: string, username: string): Promise<unknown> { return (await req(`/servers/${encodeURIComponent(id)}/access`, { method: "POST", body: JSON.stringify({ username }) })).json(); }
export async function serverRevoke(id: string, accountId: string): Promise<unknown> { return (await req(`/servers/${encodeURIComponent(id)}/access/${encodeURIComponent(accountId)}`, { method: "DELETE" })).json(); }
export async function serverCoworkKey(): Promise<{ publicKey: string | null }> { return (await req("/servers/cowork-key")).json(); }

/** Enroll the current agent's face on this device → returns a one-time device secret. */
export async function faceEnroll(descriptor: number[], deviceLabel: string): Promise<{ deviceSecret: string }> {
  return (await req("/accounts/me/face/enroll", { method: "POST", body: JSON.stringify({ descriptor, deviceLabel }) })).json();
}
/** Admin: pre-enroll a descriptor computed from an agent's roster photo. */
export async function faceAdminEnroll(id: string, descriptor: number[]): Promise<{ ok: boolean }> {
  return (await req(`/accounts/${encodeURIComponent(id)}/face`, { method: "POST", body: JSON.stringify({ descriptor }) })).json();
}
/** Face sign-in: device secret + live descriptor → session (public endpoint). */
export async function faceLogin(serverUrl: string, deviceSecret: string, descriptor: number[]): Promise<{ ok: boolean; token?: string; account?: { username: string; displayName: string; role: string }; error?: string }> {
  const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/face/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceSecret, descriptor }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !j.token) return { ok: false, error: String((j as { error?: string }).error ?? `HTTP ${r.status}`) };
  return { ok: true, token: String(j.token), account: j.account as { username: string; displayName: string; role: string } };
}

/** Jira OAuth: ask the server for the authorize URL + a state to poll on. */
export async function jiraOAuthStart(
  serverUrl: string,
): Promise<{ ok: boolean; authUrl?: string; state?: string; error?: string }> {
  const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/jira/start`, { method: "POST", headers: { "Content-Type": "application/json" } });
  return (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as {
    ok: boolean; authUrl?: string; state?: string; error?: string;
  };
}

/** Poll the Jira OAuth outcome by state until the browser leg completes. */
export async function jiraOAuthPoll(
  serverUrl: string,
  state: string,
): Promise<{ status: "pending" | "ok" | "error"; session?: { token: string; account: { username: string; displayName: string; role: string } }; error?: string }> {
  const r = await fetchImpl(`${trimUrl(serverUrl)}/auth/jira/poll?state=${encodeURIComponent(state)}`);
  return (await r.json().catch(() => ({ status: "error", error: `HTTP ${r.status}` }))) as {
    status: "pending" | "ok" | "error"; session?: { token: string; account: { username: string; displayName: string; role: string } }; error?: string;
  };
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

/** ——— Agent roster (enterprise accounts) ——— */
export async function accountsMe(): Promise<unknown> {
  return (await req("/accounts/me")).json();
}
export async function accountsList(): Promise<unknown[]> {
  return (await req("/accounts")).json();
}
export async function accountCreate(input: unknown): Promise<unknown> {
  return (await req("/accounts", { method: "POST", body: JSON.stringify(input) })).json();
}
export async function accountUpdateProfile(id: string, patch: unknown): Promise<unknown> {
  return (await req(`/accounts/${encodeURIComponent(id)}/profile`, { method: "POST", body: JSON.stringify(patch) })).json();
}
export async function accountSetDisabled(id: string, disabled: boolean): Promise<unknown> {
  return (await req(`/accounts/${encodeURIComponent(id)}/${disabled ? "disable" : "enable"}`, { method: "POST" })).json();
}
export async function accountsAudit(accountId?: string, limit = 100): Promise<unknown[]> {
  const q = new URLSearchParams();
  if (accountId) q.set("accountId", accountId);
  q.set("limit", String(limit));
  return (await req(`/accounts/audit/logins?${q}`)).json();
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

// ---- Jira (per-session project management) ----
const sid = (s: string) => encodeURIComponent(s);
export async function jiraProfilesList(): Promise<unknown> { return (await req("/jira/profiles")).json(); }
export async function jiraProfilePut(name: string, baseUrl: string, pat: string): Promise<unknown> {
  return (await req(`/jira/profiles/${sid(name)}`, { method: "PUT", body: JSON.stringify({ baseUrl, pat }) })).json();
}
export async function jiraProfileDelete(name: string): Promise<unknown> {
  return (await req(`/jira/profiles/${sid(name)}`, { method: "DELETE" })).json();
}
export async function jiraProfileValidate(name: string): Promise<unknown> {
  return (await req(`/jira/profiles/${sid(name)}/validate`)).json();
}
export async function jiraGetBinding(sessionId: string): Promise<unknown> {
  const t = await (await req(`/sessions/${sid(sessionId)}/jira`)).text();
  return t && t.trim() ? JSON.parse(t) : null;
}
export async function jiraSetBinding(sessionId: string, binding: { profile: string; projectKey: string; boardId?: number | null }): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira`, { method: "PUT", body: JSON.stringify(binding) })).json();
}
export async function jiraClearBinding(sessionId: string): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira`, { method: "DELETE" })).json();
}
export async function jiraSessionIssues(sessionId: string): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira/issues`)).json();
}
export async function jiraIssueDetail(sessionId: string, key: string): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira/issues/${sid(key)}`)).json();
}
export async function jiraCreateIssue(sessionId: string, summary: string): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira/issues`, { method: "POST", body: JSON.stringify({ summary }) })).json();
}
export async function jiraUpdateIssue(sessionId: string, key: string, fields: { summary?: string; description?: string }): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira/issues/${sid(key)}`, { method: "PUT", body: JSON.stringify(fields) })).json();
}
export async function jiraCreateSubtask(sessionId: string, key: string, summary: string, description?: string): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira/issues/${sid(key)}/subtasks`, { method: "POST", body: JSON.stringify({ summary, description }) })).json();
}
export async function jiraIssueTransitions(sessionId: string, key: string): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira/issues/${sid(key)}/transitions`)).json();
}
export async function jiraTransitionIssue(sessionId: string, key: string, transitionId: string): Promise<unknown> {
  return (await req(`/sessions/${sid(sessionId)}/jira/issues/${sid(key)}/transitions`, { method: "POST", body: JSON.stringify({ transitionId }) })).json();
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
  onEvent: (e: { type: string; payload: unknown }) => void,
  // Optional gate from the caller (main/index.ts) so this framework-free module
  // stays importable in tests — used to skip polling when no window is visible.
  shouldPoll?: () => boolean
): () => void {
  let stopped = false;
  let backoff = 1000;
  const backoffSteps = [1000, 2000, 5000];
  let backoffIdx = 0;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let connected = false;

  // Poll (only while a window is visible — no work when backgrounded):
  //   - stream DOWN  → poll IS the data source, every 3s.
  //   - stream UP    → poll is a BACKSTOP every ~9s. The stream doesn't reliably
  //     push every transition (notably a turn ending / a decision resolving), and
  //     the cockpit detects a turn's end by comparing state ACROSS refreshes — so
  //     with no backstop a session could sit "waiting"/"working" forever after
  //     Claude finished. Gentle enough to keep the idle/battery win.
  let tick = 0;
  const pollInterval = setInterval(() => {
    if (stopped) return;
    if (shouldPoll && !shouldPoll()) return;
    tick++;
    if (connected && tick % 3 !== 0) return; // connected → every 3rd tick (~9s)
    onEvent({ type: "poll.tick", payload: null });
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

      // (Re)connected: mark healthy and force one immediate refresh so the UI
      // isn't stale after a gap in the stream.
      connected = true;
      onEvent({ type: "poll.tick", payload: null });

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
      connected = false;
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
