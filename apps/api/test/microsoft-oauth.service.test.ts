import { describe, it, expect, vi } from "vitest";
import { MicrosoftOAuthService } from "../src/application/microsoft-oauth.service";

const res = (ok: boolean, body: unknown, status = ok ? 200 : 400) =>
  ({ ok, status, json: async () => body }) as Response;

const creds = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://cowork.example.com/api/oauth/microsoft/callback",
};

// id_token with payload { preferred_username: "boss@example.com" } — only the middle segment is read.
const idToken = `h.${Buffer.from(JSON.stringify({ preferred_username: "boss@example.com" })).toString("base64url")}.s`;

describe("MicrosoftOAuthService", () => {
  it("buildAuthUrl carries the offline-consent params and state", () => {
    const svc = new MicrosoftOAuthService({ ...creds }, { create: vi.fn() } as never);
    const url = new URL(svc.buildAuthUrl("state123"));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(creds.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Mail.Read");
    expect(url.searchParams.get("scope")).toContain("Calendars.Read");
  });

  it("exchangeAndConnect swaps the code and creates a microsoft connection", async () => {
    const fetchImpl = vi.fn(async () => res(true, { refresh_token: "rt", access_token: "at", id_token: idToken }));
    const create = vi.fn(async (input: unknown) => ({ id: "conn1", ...(input as object) }));
    const svc = new MicrosoftOAuthService({ ...creds, fetchImpl: fetchImpl as never }, { create } as never);

    const conn = await svc.exchangeAndConnect("auth-code");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(String((init as RequestInit).body)).toContain("grant_type=authorization_code");
    expect(String((init as RequestInit).body)).toContain("code=auth-code");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "microsoft", endpoint: "https://graph.microsoft.com", token: "rt", label: "boss@example.com" }),
    );
    expect(conn).toMatchObject({ id: "conn1" });
  });

  it("throws when consent did not return a refresh token", async () => {
    const fetchImpl = vi.fn(async () => res(true, { access_token: "at" }));
    const svc = new MicrosoftOAuthService({ ...creds, fetchImpl: fetchImpl as never }, { create: vi.fn() } as never);
    await expect(svc.exchangeAndConnect("code")).rejects.toThrow(/refresh token/i);
  });
});
