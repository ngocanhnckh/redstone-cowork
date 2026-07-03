import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("/sessions", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("401s without token", async () => {
    await request(app.getHttpServer()).get("/sessions").expect(401);
  });

  it("attaches, heartbeats, lists with status", async () => {
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-1", machine: "devbox", cwd: "/p", gitBranch: "main" }).expect(201);
    await request(app.getHttpServer()).post("/sessions/sess-1/heartbeat").set(auth).expect(200);
    const res = await request(app.getHttpServer()).get("/sessions").set(auth).expect(200);
    const s = res.body.find((x: { id: string }) => x.id === "sess-1");
    expect(s.status).toBe("active");
    expect(s.pendingDecisions).toBe(0);
  });

  it("404s heartbeat for unknown session", async () => {
    await request(app.getHttpServer()).post("/sessions/nope/heartbeat").set(auth).expect(404);
  });

  it("attach is idempotent (re-attach updates lastSeen)", async () => {
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-1", machine: "devbox", cwd: "/p" }).expect(201);
  });

  it("dismiss closes a session and drops it from GET /sessions", async () => {
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-dismiss", machine: "devbox", cwd: "/p" }).expect(201);
    let res = await request(app.getHttpServer()).get("/sessions").set(auth).expect(200);
    expect(res.body.map((x: { id: string }) => x.id)).toContain("sess-dismiss");

    const dis = await request(app.getHttpServer()).post("/sessions/sess-dismiss/dismiss").set(auth).expect(200);
    expect(dis.body).toEqual({ ok: true });

    res = await request(app.getHttpServer()).get("/sessions").set(auth).expect(200);
    expect(res.body.map((x: { id: string }) => x.id)).not.toContain("sess-dismiss");
  });

  it("404s dismiss for an unknown session", async () => {
    await request(app.getHttpServer()).post("/sessions/nope/dismiss").set(auth).expect(404);
  });
});
