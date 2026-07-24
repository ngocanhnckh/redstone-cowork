import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

describe("agency messaging", () => {
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
  const mkAgent = async (adminTok: string, username: string) =>
    (await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`).send({ username, password: username + "-pw1" })).body.id as string;

  it("org chat: agents post and read enriched messages", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await mkAgent(adminTok, "agent.chat");
    const aTok = await login("agent.chat", "agent.chat-pw1");

    const posted = await request(app.getHttpServer()).post("/agency/chat").set("Authorization", `Bearer ${aTok}`).send({ body: "hello agency" });
    expect(posted.status).toBe(200);
    expect(posted.body.body).toBe("hello agency");
    expect(posted.body.from.username).toBe("agent.chat");

    const list = await request(app.getHttpServer()).get("/agency/chat").set("Authorization", `Bearer ${adminTok}`);
    expect(list.body.map((m: { body: string }) => m.body)).toContain("hello agency");

    // incremental fetch after the last id returns nothing new
    const after = await request(app.getHttpServer()).get(`/agency/chat?afterId=${posted.body.id}`).set("Authorization", `Bearer ${aTok}`);
    expect(after.body).toHaveLength(0);

    // empty message rejected
    const empty = await request(app.getHttpServer()).post("/agency/chat").set("Authorization", `Bearer ${aTok}`).send({ body: "   " });
    expect(empty.status).toBe(400);
  });

  it("DMs: shared thread between two agents, isolated from a third", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    const bId = await mkAgent(adminTok, "agent.b");
    await mkAgent(adminTok, "agent.a"); await mkAgent(adminTok, "agent.c");
    const aTok = await login("agent.a", "agent.a-pw1");
    const bTok = await login("agent.b", "agent.b-pw1");
    const cTok = await login("agent.c", "agent.c-pw1");

    const dm = await request(app.getHttpServer()).post(`/agency/dm/${bId}`).set("Authorization", `Bearer ${aTok}`).send({ body: "psst, b" });
    expect(dm.status).toBe(200);

    // B sees it in the shared thread (keyed by the pair, order-independent)
    const aId = (await request(app.getHttpServer()).get("/accounts").set("Authorization", `Bearer ${adminTok}`)).body.find((x: { username: string }) => x.username === "agent.a").id;
    const bView = await request(app.getHttpServer()).get(`/agency/dm/${aId}`).set("Authorization", `Bearer ${bTok}`);
    expect(bView.body.map((m: { body: string }) => m.body)).toContain("psst, b");

    // B's DM inbox lists the thread with A
    const threads = await request(app.getHttpServer()).get("/agency/dm").set("Authorization", `Bearer ${bTok}`);
    expect(threads.body.some((t: { other: { username: string } }) => t.other.username === "agent.a")).toBe(true);

    // C is not part of the A↔B thread
    const cThreads = await request(app.getHttpServer()).get("/agency/dm").set("Authorization", `Bearer ${cTok}`);
    expect(cThreads.body).toHaveLength(0);
  });

  it("org chat requires an agent (instance token is not a person)", async () => {
    const r = await request(app.getHttpServer()).post("/agency/chat").set("Authorization", `Bearer ${INSTANCE}`).send({ body: "hi" });
    expect(r.status).toBe(403);
  });
});
