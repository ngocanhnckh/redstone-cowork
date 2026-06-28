import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const auth = { Authorization: "Bearer test-token" };

describe("ssh onboarding", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post("/sessions").set(auth).send({
      id: "sess-ssh", machine: "m", cwd: "/p", gitBranch: null,
      wrapperId: "wrap-ssh", autoModeEnabled: false, permissionMode: "default",
    });
  });
  afterAll(() => app.close());

  it("GET ssh-result returns null before any result is posted", async () => {
    const r = await request(app.getHttpServer())
      .get("/sessions/sess-ssh/ssh-result")
      .set(auth)
      .expect(200);
    expect(r.body == null || Object.keys(r.body).length === 0).toBe(true);
  });

  it("POST ssh-authorize creates a deliverable visible to the agent poller", async () => {
    const r = await request(app.getHttpServer())
      .post("/sessions/sess-ssh/ssh-authorize")
      .set(auth)
      .send({ publicKey: "ssh-ed25519 AAAAC3Nz desktop@redstone" })
      .expect(200);
    expect(r.body.ok).toBe(true);

    const del = await request(app.getHttpServer())
      .get("/sessions/by-wrapper/wrap-ssh/deliveries?timeoutMs=500")
      .set(auth)
      .expect(200);
    const ssh = del.body.find((d: { kind: string }) => d.kind === "ssh-authorize");
    expect(ssh).toBeDefined();
    expect(ssh.body.publicKey).toBe("ssh-ed25519 AAAAC3Nz desktop@redstone");
    expect(ssh.status).toBe("resolved");
    // Ack so it doesn't linger
    await request(app.getHttpServer())
      .post(`/decisions/${ssh.id}/delivered`)
      .set(auth)
      .expect(200);
  });

  it("POST ssh-result stores it; GET returns the stored result", async () => {
    await request(app.getHttpServer())
      .post("/sessions/sess-ssh/ssh-result")
      .set(auth)
      .send({ ok: true, user: "anh", address: "203.0.113.5", port: 22 })
      .expect(200);

    const r = await request(app.getHttpServer())
      .get("/sessions/sess-ssh/ssh-result")
      .set(auth)
      .expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.user).toBe("anh");
    expect(r.body.address).toBe("203.0.113.5");
    expect(r.body.port).toBe(22);
    expect(typeof r.body.at).toBe("string");
  });

  it("ssh-authorize 404s for an unknown session", async () => {
    await request(app.getHttpServer())
      .post("/sessions/nope/ssh-authorize")
      .set(auth)
      .send({ publicKey: "ssh-ed25519 AAAA" })
      .expect(404);
  });

  it("ssh-authorize 400s for an empty publicKey", async () => {
    await request(app.getHttpServer())
      .post("/sessions/sess-ssh/ssh-authorize")
      .set(auth)
      .send({ publicKey: "" })
      .expect(400);
  });

  it("ssh-result 400s when ok is missing", async () => {
    await request(app.getHttpServer())
      .post("/sessions/sess-ssh/ssh-result")
      .set(auth)
      .send({ user: "x" })
      .expect(400);
  });
});
