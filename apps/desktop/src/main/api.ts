import { getToken, loadConfig } from "./config";

let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);

export function setFetch(f: typeof fetch): void {
  fetchImpl = f;
}

function cfg(): { serverUrl: string; token: string } {
  const config = loadConfig();
  const token = getToken();
  if (!config?.serverUrl || !token) throw new Error("not configured");
  return { serverUrl: config.serverUrl, token };
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  const { serverUrl, token } = cfg();
  const res = await fetchImpl(serverUrl + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res;
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
  };
}
