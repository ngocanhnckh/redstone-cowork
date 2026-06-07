import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("decision resolve + await", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post("/sessions").set(auth).send({ id: "sess-r", machine: "m", cwd: "/p" });
  });
  afterAll(() => app.close());

  const createDecision = async () => {
    const r = await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-r", kind: "permission", title: "t", options: [{ label: "Allow" }] });
    return r.body.id as string;
  };

  it("resolves exactly once — second resolver gets 409", async () => {
    const id = await createDecision();
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth)
      .send({ choice: "Allow" }).expect(200);
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth)
      .send({ choice: "Deny" }).expect(409);
  });

  it("await returns resolution when resolved mid-poll", async () => {
    const id = await createDecision();
    const awaitP = request(app.getHttpServer())
      .get(`/decisions/${id}/await?timeoutMs=5000`).set(auth);
    await new Promise((r) => setTimeout(r, 150));
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth).send({ choice: "Allow" });
    const res = await awaitP;
    expect(res.status).toBe(200);
    expect(res.body.resolution.choice).toBe("Allow");
  });

  it("await times out with 204 when unresolved", async () => {
    const id = await createDecision();
    await request(app.getHttpServer())
      .get(`/decisions/${id}/await?timeoutMs=300`).set(auth).expect(204);
  });

  it("await returns immediately for already-resolved decision", async () => {
    const id = await createDecision();
    await request(app.getHttpServer()).post(`/decisions/${id}/resolve`).set(auth).send({ choice: "Allow" });
    const res = await request(app.getHttpServer())
      .get(`/decisions/${id}/await?timeoutMs=5000`).set(auth).expect(200);
    expect(res.body.status).toBe("resolved");
  });
});
