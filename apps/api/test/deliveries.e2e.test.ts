import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("delivery queue", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-w", machine: "m", cwd: "/p", gitBranch: null, wrapperId: "wrap1" });
  });
  afterAll(() => app.close());

  it("finds session by wrapper id", async () => {
    const r = await request(app.getHttpServer()).get("/sessions/by-wrapper/wrap1").set(auth).expect(200);
    expect(r.body.id).toBe("sess-w");
    await request(app.getHttpServer()).get("/sessions/by-wrapper/nope").set(auth).expect(404);
  });

  it("instruct creates a pre-resolved instruction that appears in deliveries, ack removes it", async () => {
    await request(app.getHttpServer()).post("/sessions/sess-w/instruct").set(auth)
      .send({ text: "pnpm test" }).expect(201);
    const del = await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=500").set(auth).expect(200);
    expect(del.body[0].kind).toBe("instruction");
    expect(del.body[0].resolution.custom).toBe("pnpm test");
    await request(app.getHttpServer()).post(`/decisions/${del.body[0].id}/delivered`).set(auth).expect(200);
    await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=300").set(auth).expect(204);
  });

  it("resolving a pending decision wakes the deliveries long-poll", async () => {
    const d = await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-w", kind: "permission", title: "t", options: [{ label: "Allow" }] });
    const poll = request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=5000").set(auth);
    await new Promise((r) => setTimeout(r, 150));
    await request(app.getHttpServer()).post(`/decisions/${d.body.id}/resolve`).set(auth).send({ choice: "Allow" });
    const res = await poll;
    expect(res.status).toBe(200);
    expect(res.body.some((x: { id: string }) => x.id === d.body.id)).toBe(true);
    await request(app.getHttpServer()).post(`/decisions/${d.body.id}/delivered`).set(auth);
  });

  it("resolve-local resolves all pending permission/question decisions as answered-at-terminal and marks them delivered", async () => {
    const d = await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-w", kind: "permission", title: "t2", options: [{ label: "Allow" }] });
    await request(app.getHttpServer()).post("/sessions/sess-w/resolve-local").set(auth).expect(200);
    await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap1/deliveries?timeoutMs=300").set(auth).expect(204);
    const pending = await request(app.getHttpServer()).get("/decisions?status=pending").set(auth);
    expect(pending.body.some((x: { id: string }) => x.id === d.body.id)).toBe(false);
  });

  it("resolve-local scoped to a tool leaves a pending question for a different tool open", async () => {
    // A still-open AskUserQuestion card…
    const q = await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-w", kind: "question", title: "pick one", options: [{ label: "A" }], body: { tool_name: "AskUserQuestion" } });
    // …must NOT be cleared when a *parallel* tool (Read) finishes.
    await request(app.getHttpServer()).post("/sessions/sess-w/resolve-local").set(auth).send({ toolName: "Read" }).expect(200);
    let pending = await request(app.getHttpServer()).get("/decisions?status=pending").set(auth);
    expect(pending.body.some((x: { id: string }) => x.id === q.body.id)).toBe(true);
    // The matching tool's PostToolUse (user answered at the terminal) does clear it.
    await request(app.getHttpServer()).post("/sessions/sess-w/resolve-local").set(auth).send({ toolName: "AskUserQuestion" }).expect(200);
    pending = await request(app.getHttpServer()).get("/decisions?status=pending").set(auth);
    expect(pending.body.some((x: { id: string }) => x.id === q.body.id)).toBe(false);
  });
});
