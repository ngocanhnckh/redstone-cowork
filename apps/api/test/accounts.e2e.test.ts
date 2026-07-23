import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountsService, hashPassword, verifyPassword } from "../src/application/accounts.service";
import { SessionsService } from "../src/application/sessions.service";

const INSTANCE = "test-instance-token";

describe("accounts (enterprise auth)", () => {
  let app: INestApplication;
  let accounts: AccountsService;
  let sessions: SessionsService;

  beforeEach(async () => {
    process.env.INSTANCE_TOKEN = INSTANCE;
    process.env.ADMIN_USERNAME = "anh.nguyen";
    process.env.ADMIN_PASSWORD = "test-admin-password";
    const modRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modRef.createNestApplication();
    await app.init(); // onModuleInit seeds the admin account
    accounts = app.get(AccountsService);
    sessions = app.get(SessionsService);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
  });

  describe("password hashing", () => {
    it("verifies a correct password and rejects a wrong one", async () => {
      const hash = await hashPassword("s3cret-pass");
      expect(hash.startsWith("scrypt$")).toBe(true);
      expect(hash).not.toContain("s3cret-pass");
      expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
      expect(await verifyPassword("wrong", hash)).toBe(false);
      expect(await verifyPassword("s3cret-pass", "garbage")).toBe(false);
    });
  });

  describe("seeding", () => {
    it("creates the admin account from env on first boot", async () => {
      const list = await accounts.list();
      expect(list).toHaveLength(1);
      expect(list[0].username).toBe("anh.nguyen");
      expect(list[0].role).toBe("admin");
    });

    it("claims pre-existing unowned sessions for the admin", async () => {
      await sessions.attach({ id: "legacy-1", machine: "m1", cwd: "/w/a" }); // no account
      await accounts.seedAdmin(); // re-run (boot already ran once)
      const admin = (await accounts.list())[0];
      const all = await sessions.list();
      expect(all.find((s) => s.id === "legacy-1")?.accountId).toBe(admin.id);
    });
  });

  describe("login + audit", () => {
    it("logs in with correct credentials, returns rcwa_ token, records audit", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/account/login")
        .set("X-Forwarded-For", "203.0.113.7")
        .send({ username: "anh.nguyen", password: "test-admin-password", device: "Test Mac" });
      expect(res.status).toBe(200);
      expect(res.body.token).toMatch(/^rcwa_[0-9a-f]{48}$/);
      expect(res.body.account.username).toBe("anh.nguyen");
      expect(res.body.account.passwordHash).toBeUndefined();

      const audit = await accounts.loginAudit();
      expect(audit[0]).toMatchObject({ username: "anh.nguyen", ok: true, ip: "203.0.113.7", device: "Test Mac" });
    });

    it("rejects wrong password with 401 and records the failed attempt", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/account/login")
        .send({ username: "anh.nguyen", password: "nope" });
      expect(res.status).toBe(401);
      const audit = await accounts.loginAudit();
      expect(audit[0].ok).toBe(false);
    });

    it("rejects unknown username with 401 (audit keeps the typed name)", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/account/login")
        .send({ username: "ghost", password: "whatever" });
      expect(res.status).toBe(401);
      const audit = await accounts.loginAudit();
      expect(audit[0]).toMatchObject({ username: "ghost", ok: false, accountId: null });
    });
  });

  describe("bearer auth + roles", () => {
    async function login(username: string, password: string): Promise<string> {
      const res = await request(app.getHttpServer()).post("/auth/account/login").send({ username, password });
      expect(res.status).toBe(200);
      return res.body.token as string;
    }

    it("account token authenticates guarded routes; /accounts/me identifies caller", async () => {
      const token = await login("anh.nguyen", "test-admin-password");
      const me = await request(app.getHttpServer()).get("/accounts/me").set("Authorization", `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(me.body.username).toBe("anh.nguyen");
      expect(me.body.role).toBe("admin");
    });

    it("admin can create a member; member cannot create accounts", async () => {
      const adminTok = await login("anh.nguyen", "test-admin-password");
      const create = await request(app.getHttpServer())
        .post("/accounts")
        .set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "employee.a", password: "password-a1", role: "member" });
      expect(create.status).toBe(201);

      const memberTok = await login("employee.a", "password-a1");
      const forbidden = await request(app.getHttpServer())
        .post("/accounts")
        .set("Authorization", `Bearer ${memberTok}`)
        .send({ username: "employee.b", password: "password-b1" });
      expect(forbidden.status).toBe(403);
    });

    it("disabling an account revokes its tokens and blocks login", async () => {
      const adminTok = await login("anh.nguyen", "test-admin-password");
      await request(app.getHttpServer())
        .post("/accounts")
        .set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "leaver", password: "password-x9" });
      const leaverTok = await login("leaver", "password-x9");
      const leaver = (await accounts.list()).find((a) => a.username === "leaver")!;

      const dis = await request(app.getHttpServer())
        .post(`/accounts/${leaver.id}/disable`)
        .set("Authorization", `Bearer ${adminTok}`);
      expect(dis.status).toBe(200);

      const blocked = await request(app.getHttpServer()).get("/accounts/me").set("Authorization", `Bearer ${leaverTok}`);
      expect(blocked.status).toBe(401);
      const relog = await request(app.getHttpServer())
        .post("/auth/account/login")
        .send({ username: "leaver", password: "password-x9" });
      expect(relog.status).toBe(401);
    });

    it("token idles out after 30 minutes away, stays alive with activity", async () => {
      const token = await login("anh.nguyen", "test-admin-password");
      const store = (accounts as unknown as { store: import("../src/domain/accounts/account-store.port").AccountStore }).store;
      const hash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");

      // 29 minutes later: still valid (touches last_used_at → window restarts)
      const t29 = new Date(Date.now() + 29 * 60_000);
      expect(await store.findByTokenHash(hash, t29, AccountsService.idleMs())).not.toBeNull();
      // 29 + 29 minutes: still valid because activity refreshed the window
      const t58 = new Date(t29.getTime() + 29 * 60_000);
      expect(await store.findByTokenHash(hash, t58, AccountsService.idleMs())).not.toBeNull();
      // 31 minutes of silence: expired — and permanently revoked
      const t89 = new Date(t58.getTime() + 31 * 60_000);
      expect(await store.findByTokenHash(hash, t89, AccountsService.idleMs())).toBeNull();
      expect(await store.findByTokenHash(hash, t89, AccountsService.idleMs())).toBeNull();
    });

    it("instance token still works everywhere (back-compat)", async () => {
      const res = await request(app.getHttpServer()).get("/sessions").set("Authorization", `Bearer ${INSTANCE}`);
      expect(res.status).toBe(200);
    });
  });

  describe("per-account session visibility", () => {
    async function login(username: string, password: string): Promise<string> {
      const res = await request(app.getHttpServer()).post("/auth/account/login").send({ username, password });
      return res.body.token as string;
    }

    it("members see only their own sessions; admin sees all", async () => {
      const adminTok = await login("anh.nguyen", "test-admin-password");
      await request(app.getHttpServer())
        .post("/accounts").set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "employee.a", password: "password-a1" });
      await request(app.getHttpServer())
        .post("/accounts").set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "employee.b", password: "password-b1" });
      const tokA = await login("employee.a", "password-a1");
      const tokB = await login("employee.b", "password-b1");

      // employee A and B attach sessions on the same VPS, different folders
      await request(app.getHttpServer())
        .post("/sessions").set("Authorization", `Bearer ${tokA}`)
        .send({ id: "sess-a", machine: "vps-1", cwd: "/home/a/project" });
      await request(app.getHttpServer())
        .post("/sessions").set("Authorization", `Bearer ${tokB}`)
        .send({ id: "sess-b", machine: "vps-1", cwd: "/home/b/project" });

      const seenByA = await request(app.getHttpServer()).get("/sessions").set("Authorization", `Bearer ${tokA}`);
      expect(seenByA.body.map((s: { id: string }) => s.id)).toEqual(["sess-a"]);

      const seenByB = await request(app.getHttpServer()).get("/sessions").set("Authorization", `Bearer ${tokB}`);
      expect(seenByB.body.map((s: { id: string }) => s.id)).toEqual(["sess-b"]);

      const seenByAdmin = await request(app.getHttpServer()).get("/sessions").set("Authorization", `Bearer ${adminTok}`);
      const ids = seenByAdmin.body.map((s: { id: string }) => s.id);
      expect(ids).toContain("sess-a");
      expect(ids).toContain("sess-b");
    });

    it("re-attach (resume) never steals ownership", async () => {
      const adminTok = await login("anh.nguyen", "test-admin-password");
      await request(app.getHttpServer())
        .post("/accounts").set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "employee.a", password: "password-a1" });
      const tokA = await login("employee.a", "password-a1");

      await request(app.getHttpServer())
        .post("/sessions").set("Authorization", `Bearer ${tokA}`)
        .send({ id: "sess-owned", machine: "vps-1", cwd: "/home/a/p" });
      // hook re-attaches with the instance token (no account)
      await request(app.getHttpServer())
        .post("/sessions").set("Authorization", `Bearer ${INSTANCE}`)
        .send({ id: "sess-owned", machine: "vps-1", cwd: "/home/a/p" });

      const seenByA = await request(app.getHttpServer()).get("/sessions").set("Authorization", `Bearer ${tokA}`);
      expect(seenByA.body.map((s: { id: string }) => s.id)).toContain("sess-owned");
    });
  });

  describe("agent profiles", () => {
    it("admin sets photo/level/division/contacts/webhook; member cannot", async () => {
      const login = async (u: string, p: string) =>
        (await request(app.getHttpServer()).post("/auth/account/login").send({ username: u, password: p })).body.token as string;
      const adminTok = await login("anh.nguyen", "test-admin-password");
      const created = await request(app.getHttpServer())
        .post("/accounts").set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "agent.x", password: "password-x1", displayName: "Agent X", level: "L3", division: "Cyber Ops" });
      expect(created.status).toBe(201);
      expect(created.body.level).toBe("L3");

      const patched = await request(app.getHttpServer())
        .post(`/accounts/${created.body.id}/profile`).set("Authorization", `Bearer ${adminTok}`)
        .send({
          photo: "data:image/jpeg;base64,/9j/AAAA", level: "L4", division: "Signals",
          email: "x@yitec.dev", jira: "agent.x", mattermost: "agentx", phone: "+84 90 000 0000",
          webhook: "https://hooks.example.com/agent-x",
        });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ level: "L4", division: "Signals", email: "x@yitec.dev", webhook: "https://hooks.example.com/agent-x" });
      expect(patched.body.photo).toContain("data:image/jpeg");

      const memberTok = await login("agent.x", "password-x1");
      const forbidden = await request(app.getHttpServer())
        .post(`/accounts/${created.body.id}/profile`).set("Authorization", `Bearer ${memberTok}`)
        .send({ level: "L9" });
      expect(forbidden.status).toBe(403);

      // profile fields ride /accounts/me for the signed-in agent
      const me = await request(app.getHttpServer()).get("/accounts/me").set("Authorization", `Bearer ${memberTok}`);
      expect(me.body.division).toBe("Signals");
    });
  });

  describe("jira inbound webhook", () => {
    it("routes an assigned-issue event to the matching agent (secret-gated)", async () => {
      process.env.JIRA_WEBHOOK_SECRET = "hook-secret-1";
      const login = async (u: string, p: string) =>
        (await request(app.getHttpServer()).post("/auth/account/login").send({ username: u, password: p })).body.token as string;
      const adminTok = await login("anh.nguyen", "test-admin-password");
      await request(app.getHttpServer())
        .post("/accounts").set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "agent.j", password: "password-j1", jira: "jdoe", webhook: "https://hooks.invalid/agent-j" });

      const payload = {
        webhookEvent: "jira:issue_updated",
        issue_event_type_name: "issue_assigned",
        user: { name: "anh.nguyen", displayName: "Anh Nguyen" },
        issue: { key: "RCW-99", fields: { summary: "Infiltrate staging", status: { name: "In Progress" }, assignee: { name: "JDOE" }, project: { key: "RCW" } } },
      };
      const noSecret = await request(app.getHttpServer()).post("/hooks/jira").send(payload);
      expect(noSecret.status).toBe(401);
      const wrong = await request(app.getHttpServer()).post("/hooks/jira?secret=nope").send(payload);
      expect(wrong.status).toBe(401);
      const ok = await request(app.getHttpServer()).post("/hooks/jira?secret=hook-secret-1").send(payload);
      expect(ok.status).toBe(200);
      expect(ok.body.forwarded).toBe(true); // matched agent.j via case-insensitive jira username

      const unmatched = await request(app.getHttpServer())
        .post("/hooks/jira?secret=hook-secret-1")
        .send({ ...payload, issue: { ...payload.issue, fields: { ...payload.issue.fields, assignee: { name: "ghost" } } } });
      expect(unmatched.body.forwarded).toBe(false);
      delete process.env.JIRA_WEBHOOK_SECRET;
    });
  });

  describe("audit endpoint", () => {
    it("member sees only their own logins; admin sees everyone", async () => {
      const adminRes = await request(app.getHttpServer())
        .post("/auth/account/login")
        .send({ username: "anh.nguyen", password: "test-admin-password" });
      const adminTok = adminRes.body.token as string;
      await request(app.getHttpServer())
        .post("/accounts").set("Authorization", `Bearer ${adminTok}`)
        .send({ username: "employee.a", password: "password-a1" });
      const aRes = await request(app.getHttpServer())
        .post("/auth/account/login")
        .send({ username: "employee.a", password: "password-a1" });
      const tokA = aRes.body.token as string;

      const mine = await request(app.getHttpServer())
        .get("/accounts/audit/logins").set("Authorization", `Bearer ${tokA}`);
      expect(mine.status).toBe(200);
      expect(mine.body.every((e: { username: string }) => e.username === "employee.a")).toBe(true);

      const all = await request(app.getHttpServer())
        .get("/accounts/audit/logins").set("Authorization", `Bearer ${adminTok}`);
      const names = new Set(all.body.map((e: { username: string }) => e.username));
      expect(names.has("anh.nguyen")).toBe(true);
      expect(names.has("employee.a")).toBe(true);
    });
  });
});
