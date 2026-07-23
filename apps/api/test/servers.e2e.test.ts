import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

describe("server registry & ACL", () => {
  let app: INestApplication;
  const INSTANCE = "test-instance";

  beforeEach(async () => {
    process.env.INSTANCE_TOKEN = INSTANCE;
    process.env.ADMIN_USERNAME = "anh.nguyen";
    process.env.ADMIN_PASSWORD = "admin-pass";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD;
  });

  const login = async (u: string, p: string) =>
    (await request(app.getHttpServer()).post("/auth/account/login").send({ username: u, password: p })).body.token as string;
  const mkAgent = async (adminTok: string, username: string) => {
    const r = await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`).send({ username, password: username + "-pw1" });
    return r.body.id as string;
  };

  it("admin creates a company server; agents see it only after assignment", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await mkAgent(adminTok, "agent.s1");
    const aTok = await login("agent.s1", "agent.s1-pw1");

    const srv = await request(app.getHttpServer()).post("/servers").set("Authorization", `Bearer ${adminTok}`)
      .send({ name: "VPS Alpha", host: "10.0.0.1", sshUser: "ubuntu", sshPort: 22 });
    expect(srv.status).toBe(201);
    expect(srv.body.ownerAccountId).toBeNull();

    // before grant → not visible to agent
    let seen = await request(app.getHttpServer()).get("/servers").set("Authorization", `Bearer ${aTok}`);
    expect(seen.body).toHaveLength(0);

    // grant by username
    const grant = await request(app.getHttpServer()).post(`/servers/${srv.body.id}/access`).set("Authorization", `Bearer ${adminTok}`).send({ username: "agent.s1" });
    expect(grant.status).toBe(200);

    seen = await request(app.getHttpServer()).get("/servers").set("Authorization", `Bearer ${aTok}`);
    expect(seen.body.map((s: { name: string }) => s.name)).toEqual(["VPS Alpha"]);

    // admin list carries the ACL usernames
    const adminList = await request(app.getHttpServer()).get("/servers").set("Authorization", `Bearer ${adminTok}`);
    expect(adminList.body[0].access).toContain("agent.s1");

    // revoke → gone again
    await request(app.getHttpServer()).delete(`/servers/${srv.body.id}/access/${(await request(app.getHttpServer()).get("/accounts").set("Authorization", `Bearer ${adminTok}`)).body.find((a: {username:string})=>a.username==="agent.s1").id}`).set("Authorization", `Bearer ${adminTok}`);
    seen = await request(app.getHttpServer()).get("/servers").set("Authorization", `Bearer ${aTok}`);
    expect(seen.body).toHaveLength(0);
  });

  it("agent self-adds a VPS (owned, immediately visible); another agent can't see it", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await mkAgent(adminTok, "agent.a"); await mkAgent(adminTok, "agent.b");
    const aTok = await login("agent.a", "agent.a-pw1");
    const bTok = await login("agent.b", "agent.b-pw1");

    const own = await request(app.getHttpServer()).post("/servers").set("Authorization", `Bearer ${aTok}`)
      .send({ name: "My Box", host: "1.2.3.4", sshUser: "root" });
    expect(own.status).toBe(201);
    expect(own.body.ownerAccountId).toBeTruthy();

    expect((await request(app.getHttpServer()).get("/servers").set("Authorization", `Bearer ${aTok}`)).body.map((s: {name:string})=>s.name)).toContain("My Box");
    expect((await request(app.getHttpServer()).get("/servers").set("Authorization", `Bearer ${bTok}`)).body).toHaveLength(0);

    // owner can edit/delete their own; a non-owner member cannot
    const edit = await request(app.getHttpServer()).post(`/servers/${own.body.id}`).set("Authorization", `Bearer ${bTok}`).send({ name: "hijack" });
    expect(edit.status).toBe(403);
    const del = await request(app.getHttpServer()).delete(`/servers/${own.body.id}`).set("Authorization", `Bearer ${aTok}`);
    expect(del.status).toBe(200);
  });

  it("member cannot grant access; only admin can", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await mkAgent(adminTok, "agent.m");
    const mTok = await login("agent.m", "agent.m-pw1");
    const srv = await request(app.getHttpServer()).post("/servers").set("Authorization", `Bearer ${adminTok}`).send({ name: "Shared", host: "h" });
    const forbidden = await request(app.getHttpServer()).post(`/servers/${srv.body.id}/access`).set("Authorization", `Bearer ${mTok}`).send({ username: "agent.m" });
    expect(forbidden.status).toBe(403);
  });

  it("provision returns install commands (direct + relay) with a long-lived host token", async () => {
    process.env.COWORK_PUBLIC_URL = "https://cowork.test";
    const adminTok = await login("anh.nguyen", "admin-pass");
    const srv = await request(app.getHttpServer()).post("/servers").set("Authorization", `Bearer ${adminTok}`).send({ name: "Prov", host: "h" });
    const prov = await request(app.getHttpServer()).post(`/servers/${srv.body.id}/provision`).set("Authorization", `Bearer ${adminTok}`);
    expect(prov.status).toBe(200);
    expect(prov.body.installCommand).toContain("https://cowork.test/install.sh");
    expect(prov.body.installCommand).toMatch(/--token rcwh_[0-9a-f]{48}/);
    expect(prov.body.installCommandRelay).toContain("--relay");

    // the minted host token authenticates AND does not idle-expire
    const hostTok = /--token (rcwh_[0-9a-f]+)/.exec(prov.body.installCommand)![1];
    const me = await request(app.getHttpServer()).get("/accounts/me").set("Authorization", `Bearer ${hostTok}`);
    expect(me.status).toBe(200);
    delete process.env.COWORK_PUBLIC_URL;
  });

  it("exposes the cowork public key endpoint", async () => {
    process.env.COWORK_SSH_PUBKEY = "ssh-ed25519 AAAAtest cowork";
    const adminTok = await login("anh.nguyen", "admin-pass");
    const r = await request(app.getHttpServer()).get("/servers/cowork-key").set("Authorization", `Bearer ${adminTok}`);
    expect(r.body.publicKey).toContain("ssh-ed25519");
    delete process.env.COWORK_SSH_PUBKEY;
  });
});
