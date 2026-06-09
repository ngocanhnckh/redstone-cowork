import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("/decisions", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post("/sessions").set(auth)
      .send({ id: "sess-d", machine: "m", cwd: "/p" });
  });
  afterAll(() => app.close());

  it("creates and lists a pending decision; session shows waiting", async () => {
    const created = await request(app.getHttpServer()).post("/decisions").set(auth).send({
      sessionId: "sess-d", kind: "permission", title: "Bash: npm install",
      body: { tool_name: "Bash" }, options: [{ label: "Allow" }, { label: "Deny" }],
    }).expect(201);
    expect(created.body.status).toBe("pending");

    const list = await request(app.getHttpServer()).get("/decisions?status=pending").set(auth).expect(200);
    expect(list.body.some((d: { id: string }) => d.id === created.body.id)).toBe(true);

    const sessions = await request(app.getHttpServer()).get("/sessions").set(auth).expect(200);
    const s = sessions.body.find((x: { id: string }) => x.id === "sess-d");
    expect(s.status).toBe("waiting");
    expect(s.pendingDecisions).toBeGreaterThan(0);
  });

  it("preserves ALL AskUserQuestion questions in body through create + list (multi-question)", async () => {
    const tool_input = {
      questions: [
        { question: "Season?", options: [{ label: "Spring" }, { label: "Summer" }], multiSelect: false },
        { question: "Meal?", options: [{ label: "Pizza" }, { label: "Sushi" }], multiSelect: false },
        { question: "Weekend?", options: [{ label: "Reading" }, { label: "Hiking" }], multiSelect: true },
      ],
    };
    const created = await request(app.getHttpServer()).post("/decisions").set(auth).send({
      sessionId: "sess-d", kind: "question", title: "Season?",
      body: { tool_input, deliverable: true }, options: tool_input.questions[0].options,
    }).expect(201);

    const list = await request(app.getHttpServer()).get("/decisions?status=pending").set(auth).expect(200);
    const found = list.body.find((d: { id: string }) => d.id === created.body.id);
    expect(found).toBeDefined();
    // the web reads body.tool_input.questions to render the whole form
    expect(found.body.tool_input.questions).toHaveLength(3);
    expect(found.body.tool_input.questions[2].multiSelect).toBe(true);
  });

  it("accepts a multi-question resolution with single + multiSelect answers", async () => {
    const created = await request(app.getHttpServer()).post("/decisions").set(auth).send({
      sessionId: "sess-d", kind: "question", title: "Pick",
      body: { tool_input: { questions: [
        { question: "Season?", options: [{ label: "Spring" }] },
        { question: "Weekend?", options: [{ label: "Reading" }, { label: "Hiking" }], multiSelect: true },
      ] } },
      options: [{ label: "Spring" }],
    }).expect(201);
    const resolved = await request(app.getHttpServer()).post(`/decisions/${created.body.id}/resolve`).set(auth).send({
      choice: null, answers: { "Season?": "Spring", "Weekend?": ["Reading", "Hiking"] }, custom: null,
    }).expect(200);
    expect(resolved.body.resolution.answers["Weekend?"]).toEqual(["Reading", "Hiking"]);
  });

  it("keeps only the latest passive card per session — a new one supersedes the old", async () => {
    const srv = app.getHttpServer();
    await request(srv).post("/sessions").set(auth).send({ id: "sess-notif", machine: "m", cwd: "/p" });

    const first = await request(srv).post("/decisions").set(auth).send({
      sessionId: "sess-notif", kind: "completion", title: "Claude finished task A", body: {}, options: [],
    }).expect(201);
    const second = await request(srv).post("/decisions").set(auth).send({
      sessionId: "sess-notif", kind: "notification", title: "Claude needs your permission", body: {}, options: [],
    }).expect(201);

    const list = await request(srv).get("/decisions?status=pending").set(auth).expect(200);
    const mine = list.body.filter((d: { sessionId: string }) => d.sessionId === "sess-notif");
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(second.body.id);
    // the older one is no longer pending
    expect(list.body.some((d: { id: string }) => d.id === first.body.id)).toBe(false);
  });

  it("superseding is scoped to the session — other sessions' notifications are untouched", async () => {
    const srv = app.getHttpServer();
    await request(srv).post("/sessions").set(auth).send({ id: "sess-a", machine: "m", cwd: "/p" });
    await request(srv).post("/sessions").set(auth).send({ id: "sess-b", machine: "m", cwd: "/p" });

    const a = await request(srv).post("/decisions").set(auth).send({
      sessionId: "sess-a", kind: "notification", title: "A1", body: {}, options: [],
    }).expect(201);
    await request(srv).post("/decisions").set(auth).send({
      sessionId: "sess-b", kind: "notification", title: "B1", body: {}, options: [],
    }).expect(201);

    const list = await request(srv).get("/decisions?status=pending").set(auth).expect(200);
    // sess-a's notification survives because only sess-b got a new one
    expect(list.body.some((d: { id: string }) => d.id === a.body.id)).toBe(true);
  });

  it("does NOT supersede actionable question/permission cards", async () => {
    const srv = app.getHttpServer();
    await request(srv).post("/sessions").set(auth).send({ id: "sess-keep", machine: "m", cwd: "/p" });
    const q = await request(srv).post("/decisions").set(auth).send({
      sessionId: "sess-keep", kind: "question", title: "Pick one", body: {}, options: [{ label: "A" }],
    }).expect(201);
    await request(srv).post("/decisions").set(auth).send({
      sessionId: "sess-keep", kind: "notification", title: "ping", body: {}, options: [],
    }).expect(201);

    const list = await request(srv).get("/decisions?status=pending").set(auth).expect(200);
    expect(list.body.some((d: { id: string }) => d.id === q.body.id)).toBe(true);
  });

  it("400s invalid kind", async () => {
    await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "sess-d", kind: "bogus", title: "x" }).expect(400);
  });

  it("404s decision for unknown session", async () => {
    await request(app.getHttpServer()).post("/decisions").set(auth)
      .send({ sessionId: "ghost", kind: "permission", title: "x" }).expect(404);
  });
});
