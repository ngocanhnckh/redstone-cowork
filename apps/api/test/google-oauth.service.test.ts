import { describe, it, expect, vi } from "vitest";
import { GoogleOAuthService } from "../src/application/google-oauth.service";

const res = (ok: boolean, body: unknown, status = ok ? 200 : 400) =>
  ({ ok, status, json: async () => body }) as Response;

const creds = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://cowork.example.com/api/oauth/google/callback",
};

// id_token with payload { email: "boss@example.com" } — only the middle segment is read.
const idToken = `h.${Buffer.from(JSON.stringify({ email: "boss@example.com" })).toString("base64url")}.s`;

describe("GoogleOAuthService", () => {
  it("buildAuthUrl carries the offline-consent params and state", () => {
    const svc = new GoogleOAuthService({ ...creds }, { create: vi.fn() } as never);
    const url = new URL(svc.buildAuthUrl("state123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(creds.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).toContain("calendar.readonly");
  });

  it("exchangeAndConnect swaps the code and creates a google connection", async () => {
    const fetchImpl = vi.fn(async () => res(true, { refresh_token: "rt", access_token: "at", id_token: idToken }));
    const create = vi.fn(async (input: unknown) => ({ id: "conn1", ...(input as object) }));
    const svc = new GoogleOAuthService({ ...creds, fetchImpl: fetchImpl as never }, { create } as never);

    const conn = await svc.exchangeAndConnect("auth-code");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(String((init as RequestInit).body)).toContain("grant_type=authorization_code");
    expect(String((init as RequestInit).body)).toContain("code=auth-code");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "google", endpoint: "https://www.googleapis.com", token: "rt", label: "boss@example.com" }),
    );
    expect(conn).toMatchObject({ id: "conn1" });
  });

  it("throws when consent did not return a refresh token", async () => {
    const fetchImpl = vi.fn(async () => res(true, { access_token: "at" }));
    const svc = new GoogleOAuthService({ ...creds, fetchImpl: fetchImpl as never }, { create: vi.fn() } as never);
    await expect(svc.exchangeAndConnect("code")).rejects.toThrow(/refresh token/i);
  });
});
