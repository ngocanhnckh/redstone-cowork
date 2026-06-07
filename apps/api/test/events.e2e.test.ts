import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("/events", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("rejects without token", async () => {
    await request(app.getHttpServer()).post("/events").send({ type: "a.b", source: "t" }).expect(401);
  });

  it("records and lists an event with token", async () => {
    const auth = { Authorization: "Bearer test-token" };
    const created = await request(app.getHttpServer())
      .post("/events").set(auth).send({ type: "smoke.test", source: "vitest", payload: { ok: true } })
      .expect(201);
    expect(created.body.id).toBeDefined();
    const list = await request(app.getHttpServer()).get("/events").set(auth).expect(200);
    expect(list.body.some((e: { id: string }) => e.id === created.body.id)).toBe(true);
  });

  it("400s invalid body", async () => {
    await request(app.getHttpServer())
      .post("/events").set({ Authorization: "Bearer test-token" }).send({ type: "" }).expect(400);
  });
});
