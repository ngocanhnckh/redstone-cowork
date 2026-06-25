import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TOKEN = "test-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("sessions queue + state HTTP", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  const attach = (id: string) =>
    auth(request(app.getHttpServer()).post("/sessions")).send({
      id, machine: "m", cwd: "/r", gitBranch: "main", wrapperId: "w-" + id, permissionMode: "default", autoModeEnabled: false,
    });

  it("pushes state and reads it back via the session list", async () => {
    await attach("s1").expect(201);
    await auth(request(app.getHttpServer()).post("/sessions/s1/state"))
      .send({ latestAnswer: "all done", summary: "stage 2", todos: [{ text: "ship", status: "in_progress" }] })
      .expect(201);
    const list = await auth(request(app.getHttpServer()).get("/sessions")).expect(200);
    const s1 = list.body.find((s: { id: string }) => s.id === "s1");
    expect(s1.latestAnswer).toBe("all done");
    expect(s1.todos[0].text).toBe("ship");
  });

  it("a session with a pending decision shows in /sessions/queue with waitingSince", async () => {
    await attach("s2").expect(201);
    await auth(request(app.getHttpServer()).post("/decisions"))
      .send({ sessionId: "s2", kind: "question", title: "approve?", options: [{ label: "yes" }] })
      .expect(201);
    const q = await auth(request(app.getHttpServer()).get("/sessions/queue")).expect(200);
    const s2 = q.body.find((v: { id: string }) => v.id === "s2");
    expect(s2).toBeTruthy();
    expect(s2.waitingSince).toBeTruthy();
  });

  it("pin and snooze respond ok", async () => {
    await auth(request(app.getHttpServer()).post("/sessions/s2/pin")).send({ pinned: true }).expect(200);
    await auth(request(app.getHttpServer()).post("/sessions/s2/snooze")).send({ minutes: 15 }).expect(200);
  });

  it("state on an unknown session 404s", async () => {
    await auth(request(app.getHttpServer()).post("/sessions/nope/state")).send({ summary: "x" }).expect(404);
  });
});
