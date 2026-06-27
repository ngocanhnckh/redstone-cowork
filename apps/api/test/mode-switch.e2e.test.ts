import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("mode switch", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    // Attach with autoModeEnabled + permissionMode + wrapperId so deliveries-by-wrapper works
    await request(app.getHttpServer()).post("/sessions").set(auth).send({
      id: "sess-mode", machine: "m", cwd: "/p", gitBranch: null,
      wrapperId: "wrap-mode", autoModeEnabled: true, permissionMode: "default",
    });
  });
  afterAll(() => app.close());

  it("switches to a different mode: switched=true, btabs=2 (default→plan in FULL cycle)", async () => {
    const r = await request(app.getHttpServer())
      .post("/sessions/sess-mode/mode")
      .set(auth)
      .send({ mode: "plan" })
      .expect(200);
    expect(r.body.switched).toBe(true);
    expect(r.body.btabs).toBe(2);
    expect(r.body.mode).toBe("plan");
  });

  it("the mode delivery appears in the deliveries queue with kind=mode and body.btabs=2", async () => {
    const del = await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap-mode/deliveries?timeoutMs=500")
      .set(auth)
      .expect(200);
    const modeDecision = del.body.find((d: { kind: string }) => d.kind === "mode");
    expect(modeDecision).toBeDefined();
    expect(modeDecision.body.btabs).toBe(2);
    expect(modeDecision.body.target).toBe("plan");
    // Ack it so it doesn't interfere with subsequent tests
    await request(app.getHttpServer())
      .post(`/decisions/${modeDecision.id}/delivered`)
      .set(auth)
      .expect(200);
  });

  it("switching to the SAME mode returns switched=false, btabs=0 and creates NO new deliverable", async () => {
    // Current mode is now "plan" (set optimistically in previous test)
    const r = await request(app.getHttpServer())
      .post("/sessions/sess-mode/mode")
      .set(auth)
      .send({ mode: "plan" })
      .expect(200);
    expect(r.body.switched).toBe(false);
    expect(r.body.btabs).toBe(0);

    const del = await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap-mode/deliveries?timeoutMs=300")
      .set(auth)
      .expect(204);
  });

  it("'auto' is not a real Claude mode (acceptEdits IS auto) → 400", async () => {
    await request(app.getHttpServer()).post("/sessions").set(auth).send({
      id: "sess-noauto", machine: "m", cwd: "/p", gitBranch: null,
      wrapperId: "wrap-noauto", autoModeEnabled: false, permissionMode: "default",
    });
    await request(app.getHttpServer())
      .post("/sessions/sess-noauto/mode")
      .set(auth)
      .send({ mode: "auto" })
      .expect(400);
  });

  it("after switch, GET /sessions shows permissionMode === target (optimistic)", async () => {
    const sessions = await request(app.getHttpServer()).get("/sessions").set(auth).expect(200);
    const s = sessions.body.find((x: { id: string }) => x.id === "sess-mode");
    expect(s).toBeDefined();
    expect(s.permissionMode).toBe("plan");
    expect(s.autoModeEnabled).toBe(true);
  });

  it("mode route 404s for unknown session", async () => {
    await request(app.getHttpServer())
      .post("/sessions/nope/mode")
      .set(auth)
      .send({ mode: "plan" })
      .expect(404);
  });

  it("mode route 400s for empty mode string", async () => {
    await request(app.getHttpServer())
      .post("/sessions/sess-mode/mode")
      .set(auth)
      .send({ mode: "" })
      .expect(400);
  });
});
