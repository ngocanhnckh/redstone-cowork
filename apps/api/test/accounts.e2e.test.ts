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
