import { describe, it, expect, vi, beforeEach } from "vitest";

const updateTokens = vi.fn();
vi.mock("./config", () => ({
  getToken: () => "tok",
  loadConfig: () => ({ serverUrl: "http://x", hasToken: true }),
  getRefreshToken: () => "refresh1",
  updateTokens: (...args: unknown[]) => updateTokens(...args),
}));

import * as api from "./api";

beforeEach(() => vi.restoreAllMocks());

describe("desktop api client", () => {
  it("getQueue hits /sessions/queue with bearer auth", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "s1" }]), { status: 200 }));
    api.setFetch(fetchMock as unknown as typeof fetch);
    const out = await api.getQueue();
    expect(out).toEqual([{ id: "s1" }]);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("http://x/sessions/queue");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("resolveDecision POSTs the resolution to /decisions/:id/resolve", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    api.setFetch(fetchMock as unknown as typeof fetch);
    await api.resolveDecision("d1", { choice: "yes", answers: null, custom: null });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("http://x/decisions/d1/resolve");
    expect((init as RequestInit).method).toBe("POST");
    expect(String((init as RequestInit).body)).toContain("\"choice\":\"yes\"");
  });

  it("concurrent 401s trigger only ONE refresh (single-flight), then retry succeeds", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith("/auth/redstone/refresh"))
        return new Response(JSON.stringify({ access_token: "new", refresh_token: "r2" }), { status: 200 });
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === "Bearer new"
        ? new Response(JSON.stringify([{ id: "s1" }]), { status: 200 })
        : new Response("", { status: 401 });
    });
    api.setFetch(fetchMock as unknown as typeof fetch);

    // Four data calls all 401 with the stale token at the same time.
    const results = await Promise.all([api.getQueue(), api.getQueue(), api.getQueue(), api.getQueue()]);
    results.forEach((r) => expect(r).toEqual([{ id: "s1" }]));

    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/auth/redstone/refresh"));
    expect(refreshCalls).toHaveLength(1); // refresh token rotated exactly once
    expect(updateTokens).toHaveBeenCalledWith("new", "r2");
  });

  it("parseSseBlock parses a data: line", () => {
    expect(api.parseSseBlock('data: {"type":"session.updated","payload":{"id":"s1"}}'))
      .toEqual({ type: "session.updated", payload: { id: "s1" } });
    expect(api.parseSseBlock("event: ping")).toBeNull();
  });
});
