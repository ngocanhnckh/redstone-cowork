import { describe, it, expect, vi } from "vitest";
import { RedstoneService, RedstoneAuthError } from "../src/application/redstone.service";
import type { AppConfig } from "../src/infrastructure/config";

const cfg = (over: Partial<AppConfig> = {}): AppConfig => ({
  PORT: 3001,
  INSTANCE_TOKEN: "inst",
  PROMPTS_DIR: "prompts",
  REDSTONE_ISSUER: "https://redstone.example",
  REDSTONE_CLIENT_ID: "acme-portal",
  REDSTONE_CLIENT_SECRET: "secret",
  ...over,
});

const jsonRes = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("RedstoneService.enabled", () => {
  it("false unless issuer + client id + secret all set", () => {
    expect(new RedstoneService(cfg()).enabled()).toBe(true);
    expect(new RedstoneService(cfg({ REDSTONE_CLIENT_SECRET: undefined })).enabled()).toBe(false);
    expect(new RedstoneService(cfg({ REDSTONE_ISSUER: undefined })).enabled()).toBe(false);
  });
});

describe("RedstoneService.login", () => {
  it("password-grants then resolves identity via introspect", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth2/token")) return jsonRes(200, { access_token: "AT", refresh_token: "RT", expires_in: 86400, token_type: "Bearer", scope: "openid" });
      if (url.endsWith("/oauth2/introspect")) return jsonRes(200, { active: true, sub: "u-1", username: "alice", email: "alice@x.io" });
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const svc = new RedstoneService(cfg(), fetchImpl);
    const { tokens, user } = await svc.login("alice", "pw");
    expect(tokens.access_token).toBe("AT");
    expect(tokens.refresh_token).toBe("RT");
    expect(user).toEqual({ sub: "u-1", username: "alice", email: "alice@x.io", isAdmin: false });
    // token endpoint got client creds + password grant as form fields
    const body = (fetchImpl.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain("grant_type=password");
    expect(body).toContain("client_id=acme-portal");
    expect(body).toContain("client_secret=secret");
  });

  it("maps a bad-credential grant error to RedstoneAuthError", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(400, { error: "invalid_grant", error_description: "Invalid username or password." })) as unknown as typeof fetch;
    const svc = new RedstoneService(cfg(), fetchImpl);
    await expect(svc.login("alice", "bad")).rejects.toMatchObject({ code: "invalid_grant", httpStatus: 400 });
    await expect(svc.login("alice", "bad")).rejects.toBeInstanceOf(RedstoneAuthError);
  });
});

describe("RedstoneService.verify", () => {
  it("returns the user on an active token and caches it (one introspect call)", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { active: true, sub: "u-9", preferred_username: "bob", redstone_is_admin: true })) as unknown as typeof fetch;
    const svc = new RedstoneService(cfg(), fetchImpl);
    const u1 = await svc.verify("TOK");
    const u2 = await svc.verify("TOK");
    expect(u1).toEqual({ sub: "u-9", username: "bob", email: null, isAdmin: true });
    expect(u2).toEqual(u1);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second read served from cache
  });

  it("returns null for an inactive token", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { active: false })) as unknown as typeof fetch;
    expect(await new RedstoneService(cfg(), fetchImpl).verify("TOK")).toBeNull();
  });

  it("returns null (never throws) on a transient issuer failure", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect(await new RedstoneService(cfg(), fetchImpl).verify("TOK")).toBeNull();
  });

  it("returns null when Redstone is not configured", async () => {
    const svc = new RedstoneService(cfg({ REDSTONE_ISSUER: undefined }));
    expect(await svc.verify("TOK")).toBeNull();
  });
});

describe("RedstoneService.askAgent", () => {
  it("posts the message with the user's bearer token and returns the reply", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { session_id: "s-1", reply: "You have 3 unread." })) as unknown as typeof fetch;
    const svc = new RedstoneService(cfg(), fetchImpl);
    const { reply } = await svc.askAgent("AT", "what did I miss?");
    expect(reply).toBe("You have 3 unread.");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redstone.example/api/v1/me/agent/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });
});
