import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { JiraOAuthService } from "../src/application/jira-oauth.service";
import { AccountsService } from "../src/application/accounts.service";

// A fake Jira DC: token exchange, /myself, PAT minting.
function fakeJira(user: { name: string; displayName: string; email?: string }): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, ok = true) =>
      new Response(JSON.stringify(body), { status: ok ? 200 : 400, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/rest/oauth2/latest/token")) {
      const body = String(init?.body ?? "");
      if (!body.includes("code_verifier=")) return json({ error_description: "missing PKCE" }, false);
      return json({ access_token: "jira-access-xyz", token_type: "bearer" });
    }
    if (u.endsWith("/rest/api/2/myself")) return json({ name: user.name, displayName: user.displayName, emailAddress: user.email });
    if (u.endsWith("/rest/pat/latest/tokens")) return json({ rawToken: "PAT-abc123" });
    return json({}, false);
  }) as unknown as typeof fetch;
}

describe("Jira DC OAuth sign-in", () => {
  let app: INestApplication;
  let jira: JiraOAuthService;
  let accounts: AccountsService;

  beforeEach(async () => {
    process.env.INSTANCE_TOKEN = "test-instance";
    process.env.ADMIN_USERNAME = "anh.nguyen";
    process.env.ADMIN_PASSWORD = "admin-pass";
    process.env.JIRA_OAUTH_BASE_URL = "https://jira.example.test";
    process.env.JIRA_OAUTH_CLIENT_ID = "cid";
    process.env.JIRA_OAUTH_CLIENT_SECRET = "csecret";
    process.env.CRED_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    jira = app.get(JiraOAuthService);
    accounts = app.get(AccountsService);
  });

  afterEach(async () => {
    await app.close();
    for (const k of ["JIRA_OAUTH_BASE_URL", "JIRA_OAUTH_CLIENT_ID", "JIRA_OAUTH_CLIENT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "CRED_ENCRYPTION_KEY"]) delete process.env[k];
  });

  it("advertises jira mode in /auth/config", async () => {
    const cfg = await request(app.getHttpServer()).get("/auth/config");
    expect(cfg.body.jira).toBe(true);
  });

  it("start returns a valid Jira authorize URL with PKCE", async () => {
    const res = await request(app.getHttpServer()).post("/auth/jira/start");
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const u = new URL(res.body.authUrl);
    expect(u.origin + u.pathname).toBe("https://jira.example.test/rest/oauth2/latest/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("state")).toBe(res.body.state);
  });

  it("full flow: callback provisions the agent, mints+stores PAT, poll drains session", async () => {
    jira.setFetch(fakeJira({ name: "jdoe", displayName: "Jane Doe", email: "jane@yitec.dev" }));
    const start = jira.start();
    // desktop poll is pending before consent
    expect(jira.poll(start.state).status).toBe("pending");

    // Jira redirects the browser to the callback
    const cb = await request(app.getHttpServer()).get(`/auth/jira/callback?code=authcode&state=${start.state}`);
    expect(cb.status).toBe(200);
    expect(cb.text).toContain("IDENTITY VERIFIED");

    // desktop drains the session
    const outcome = jira.poll(start.state) as { status: string; session: { token: string; account: { username: string; jira: string } } };
    expect(outcome.status).toBe("ok");
    expect(outcome.session.token).toMatch(/^rcwa_/);
    expect(outcome.session.account.jira).toBe("jdoe");
    expect(outcome.session.account.username).toBe("jdoe");

    // account now carries an ENCRYPTED Jira PAT (not the raw token)
    const acct = await accounts.list().then((l) => l.find((a) => a.jira === "jdoe")!);
    const store = (accounts as unknown as { store: import("../src/domain/accounts/account-store.port").AccountStore }).store;
    const cred = await store.getJiraPatEncrypted(acct.id);
    expect(cred).not.toBeNull();
    expect(cred!.patEncrypted).not.toContain("PAT-abc123"); // encrypted at rest
    expect(cred!.baseUrl).toBe("https://jira.example.test");

    // the minted session token authenticates
    const me = await request(app.getHttpServer()).get("/accounts/me").set("Authorization", `Bearer ${outcome.session.token}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("jdoe");
  });

  it("existing account (matched by jira username) is reused, not duplicated", async () => {
    const adminTok = (await request(app.getHttpServer()).post("/auth/account/login").send({ username: "anh.nguyen", password: "admin-pass" })).body.token;
    await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`)
      .send({ username: "preexisting", password: "password-pre1", jira: "jdoe", displayName: "Pre Existing" });

    jira.setFetch(fakeJira({ name: "jdoe", displayName: "Jane Doe" }));
    const start = jira.start();
    await request(app.getHttpServer()).get(`/auth/jira/callback?code=c&state=${start.state}`);
    const outcome = jira.poll(start.state) as { status: string; session: { account: { username: string } } };
    expect(outcome.status).toBe("ok");
    expect(outcome.session.account.username).toBe("preexisting"); // reused

    const matches = (await accounts.list()).filter((a) => a.jira === "jdoe");
    expect(matches).toHaveLength(1);
  });

  it("callback with bad state renders ACCESS DENIED and poll reports error", async () => {
    jira.setFetch(fakeJira({ name: "x", displayName: "X" }));
    const cb = await request(app.getHttpServer()).get("/auth/jira/callback?code=c&state=bogus");
    expect(cb.text).toContain("ACCESS DENIED");
  });
});
