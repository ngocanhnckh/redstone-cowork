import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("/push", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("GET /push/vapid returns a publicKey field (null when unconfigured)", async () => {
    const res = await request(app.getHttpServer()).get("/push/vapid").set(auth).expect(200);
    expect(res.body).toHaveProperty("publicKey");
  });

  it("registers and removes a subscription", async () => {
    const sub = { endpoint: "https://push.example/e2e", keys: { p256dh: "p", auth: "a" } };
    const reg = await request(app.getHttpServer()).post("/push/subscriptions").set(auth).send(sub).expect(201);
    expect(reg.body.id).toBeDefined();
    await request(app.getHttpServer())
      .post("/push/subscriptions/remove").set(auth)
      .send({ endpoint: sub.endpoint }).expect(200);
  });

  it("400s a malformed subscription", async () => {
    await request(app.getHttpServer()).post("/push/subscriptions").set(auth)
      .send({ endpoint: "not-a-url" }).expect(400);
  });

  it("401s without the instance token", async () => {
    await request(app.getHttpServer()).get("/push/vapid").expect(401);
  });
});
