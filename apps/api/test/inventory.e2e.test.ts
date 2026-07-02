import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TOKEN = "inv-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("session inventory HTTP", () => {
  let app: INestApplication;
  let base: () => string;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    base = () => app.getHttpServer();
  });
  afterAll(async () => { await app.close(); });

  it("registers a host, ingests an inventory report, and lists it grouped", async () => {
    await auth(request(base()).post("/hosts")).send({ hostId: "h1", machine: "mac", user: "me", os: "darwin" }).expect(200);
    await auth(request(base()).post("/hosts/h1/inventory")).send({
      machine: "mac",
      sessions: [
        { id: "sess-a", cwd: "/Users/me/Code/redstone-agent", title: "fix auth", lastActive: new Date().toISOString(), messageCount: 12, sizeBytes: 4096 },
        { id: "sess-b", cwd: "/Users/me/Code/betawave", title: "new feature", lastActive: new Date().toISOString(), messageCount: 3, sizeBytes: 900 },
      ],
    }).expect(200);

    const res = await auth(request(base()).get("/inventory")).expect(200);
    expect(res.body.hosts.map((h: { id: string }) => h.id)).toContain("h1");
    const ids = res.body.sessions.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["sess-a", "sess-b"]));
    const a = res.body.sessions.find((s: { id: string }) => s.id === "sess-a");
    expect(a.folder).toBe("redstone-agent");
    expect(a.source).toBe("external"); // not a live cowork session
  });

  it("filters by folder and tags a discovered session", async () => {
    const filtered = await auth(request(base()).get("/inventory?folder=betawave")).expect(200);
    expect(filtered.body.sessions.map((s: { id: string }) => s.id)).toEqual(["sess-b"]);

    await auth(request(base()).post("/inventory/sess-b/tags")).send({ tag: "Urgent" }).expect(201);
    await auth(request(base()).post("/inventory/sess-b/tags")).send({ tag: "urgent" }).expect(201); // dupe
    const tagged = await auth(request(base()).get("/inventory?tag=urgent")).expect(200);
    expect(tagged.body.sessions.find((s: { id: string }) => s.id === "sess-b")?.tags).toEqual(["Urgent"]);
  });

  it("passive run: consumer request is delivered to the host poll and its result returns", async () => {
    // Consumer asks to run a one-shot message (blocks until the host posts a result).
    // .then() actually fires the (lazy) supertest request so the command enqueues.
    const runP = auth(request(base()).post("/inventory/sess-a/run")).send({ message: "summarize the diff" }).then((r) => r);
    // Let the command enqueue, then the host polls and finds it immediately.
    await new Promise((r) => setTimeout(r, 150));
    const pollRes = await auth(request(base()).get("/hosts/h1/commands?timeoutMs=3000"));
    expect(pollRes.status).toBe(200);
    const cmd = pollRes.body[0];
    expect(cmd.kind).toBe("passive_run");
    expect(cmd.payload.sessionId).toBe("sess-a");
    expect(cmd.payload.message).toBe("summarize the diff");

    // Host executes and posts the result; the consumer's /run resolves with it.
    await auth(request(base()).post(`/hosts/h1/commands/${cmd.id}/result`)).send({ ok: true, reply: "done: 3 files" }).expect(200);
    const runRes = await runP;
    expect(runRes.status).toBe(200);
    expect(runRes.body).toEqual({ ok: true, reply: "done: 3 files" });
  });

  it("marks a session cowork-sourced when a live session with the same id exists", async () => {
    await auth(request(base()).post("/sessions")).send({
      id: "sess-live", machine: "mac", cwd: "/Users/me/Code/redstone-agent", gitBranch: "main", wrapperId: "w1", permissionMode: "default", autoModeEnabled: false,
    }).expect(201);
    await auth(request(base()).post("/hosts/h1/inventory")).send({
      machine: "mac",
      sessions: [{ id: "sess-live", cwd: "/Users/me/Code/redstone-agent", title: "live", lastActive: new Date().toISOString(), messageCount: 1, sizeBytes: 100 }],
    }).expect(200);
    const res = await auth(request(base()).get("/inventory?source=cowork")).expect(200);
    expect(res.body.sessions.find((s: { id: string }) => s.id === "sess-live")?.source).toBe("cowork");
  });

  it("rejects unauthenticated inventory access", async () => {
    await request(base()).get("/inventory").expect(401);
  });
});
