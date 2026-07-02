import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TOKEN = "ak-instance-token";
const auth = (r: request.Test, t: string) => r.set("Authorization", `Bearer ${t}`);

describe("access keys + external API auth", () => {
  let app: INestApplication;
  const srv = () => app.getHttpServer();
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    // Seed one discovered session to act on.
    await auth(request(srv()).post("/hosts"), TOKEN).send({ hostId: "hk", machine: "m" }).expect(200);
    await auth(request(srv()).post("/hosts/hk/inventory"), TOKEN).send({
      machine: "m", sessions: [{ id: "d1", cwd: "/w/proj", title: "t", lastActive: new Date().toISOString(), messageCount: 1, sizeBytes: 10 }],
    }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it("creates a key (secret shown once), lists metadata without the secret", async () => {
    const created = await auth(request(srv()).post("/access-keys"), TOKEN).send({ name: "reader", scope: "read" }).expect(201);
    expect(created.body.key).toMatch(/^rcwk_/);
    expect(created.body.scope).toBe("read");
    const list = await auth(request(srv()).get("/access-keys"), TOKEN).expect(200);
    const row = list.body.find((k: { id: string }) => k.id === created.body.id);
    expect(row).toBeTruthy();
    expect(row.key).toBeUndefined(); // never returned again
    expect(row.prefix).toBe(created.body.key.slice(0, 12));
  });

  it("a read key can read inventory but NOT run (needs control scope)", async () => {
    const key = (await auth(request(srv()).post("/access-keys"), TOKEN).send({ name: "r2", scope: "read" }).expect(201)).body.key;
    await auth(request(srv()).get("/inventory"), key).expect(200);
    await auth(request(srv()).post("/inventory/d1/run"), key).send({ message: "hi" }).expect(403);
  });

  it("a control key can trigger a run", async () => {
    const key = (await auth(request(srv()).post("/access-keys"), TOKEN).send({ name: "c1", scope: "control" }).expect(201)).body.key;
    const runP = auth(request(srv()).post("/inventory/d1/run"), key).send({ message: "go" }).then((r) => r);
    await new Promise((r) => setTimeout(r, 100));
    const poll = await auth(request(srv()).get("/hosts/hk/commands?timeoutMs=2000"), TOKEN).expect(200);
    await auth(request(srv()).post(`/hosts/hk/commands/${poll.body[0].id}/result`), TOKEN).send({ ok: true, reply: "ran" }).expect(200);
    const res = await runP;
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("ran");
  });

  it("a revoked key is rejected; access keys can't manage access keys", async () => {
    const created = (await auth(request(srv()).post("/access-keys"), TOKEN).send({ name: "temp", scope: "read" }).expect(201)).body;
    await auth(request(srv()).get("/inventory"), created.key).expect(200);
    await auth(request(srv()).post(`/access-keys/${created.id}/revoke`), TOKEN).expect(200);
    await auth(request(srv()).get("/inventory"), created.key).expect(401);
    // An access key may not hit the management endpoints (human guard only).
    const live = (await auth(request(srv()).post("/access-keys"), TOKEN).send({ name: "live", scope: "read" }).expect(201)).body;
    await auth(request(srv()).get("/access-keys"), live.key).expect(401);
  });

  it("a random bearer is rejected on the external API", async () => {
    await auth(request(srv()).get("/inventory"), "rcwk_not_a_real_key").expect(401);
    await request(srv()).get("/inventory").expect(401);
  });
});
