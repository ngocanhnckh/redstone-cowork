import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config", () => ({
  getToken: () => "tok",
  loadConfig: () => ({ serverUrl: "http://x", hasToken: true }),
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

  it("parseSseBlock parses a data: line", () => {
    expect(api.parseSseBlock('data: {"type":"session.updated","payload":{"id":"s1"}}'))
      .toEqual({ type: "session.updated", payload: { id: "s1" } });
    expect(api.parseSseBlock("event: ping")).toBeNull();
  });
});
