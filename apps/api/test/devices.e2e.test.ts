import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const MASTER = "test-master-token";
const masterAuth = { Authorization: `Bearer ${MASTER}` };

describe("/devices", () => {
  let app: INestApplication;
  let deviceToken: string;
  let deviceId: string;

  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = MASTER;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("POST /devices (master Bearer) -> 201, body.token matches /^rcwd_/, body.label set", async () => {
    const res = await request(app.getHttpServer())
      .post("/devices")
      .set(masterAuth)
      .send({ label: "my-laptop" })
      .expect(201);
    expect(res.body.token).toMatch(/^rcwd_/);
    expect(res.body.label).toBe("my-laptop");
    deviceToken = res.body.token;
    deviceId = res.body.id;
  });

  it("GET /devices (master Bearer) -> 200, array contains the device, NO token, NO tokenHash", async () => {
    const res = await request(app.getHttpServer())
      .get("/devices")
      .set(masterAuth)
      .expect(200);
    const item = res.body.find((d: { id: string }) => d.id === deviceId);
    expect(item).toBeDefined();
    expect(item.token).toBeUndefined();
    expect(item.tokenHash).toBeUndefined();
  });

  it("GET /sessions with device token -> 200 (device token authenticates normal endpoints)", async () => {
    await request(app.getHttpServer())
      .get("/sessions")
      .set({ Authorization: `Bearer ${deviceToken}` })
      .expect(200);
  });

  it("GET /devices with device token -> 403 (device token forbidden on management)", async () => {
    await request(app.getHttpServer())
      .get("/devices")
      .set({ Authorization: `Bearer ${deviceToken}` })
      .expect(403);
  });

  it("DELETE /devices/:id (master Bearer) -> 200, body { revoked: true }", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/devices/${deviceId}`)
      .set(masterAuth)
      .expect(200);
    expect(res.body).toEqual({ revoked: true });
  });

  it("after revoke: GET /sessions with the device token -> 401", async () => {
    await request(app.getHttpServer())
      .get("/sessions")
      .set({ Authorization: `Bearer ${deviceToken}` })
      .expect(401);
  });

  it("GET /sessions with Authorization: Bearer rcwd_bogus -> 401", async () => {
    await request(app.getHttpServer())
      .get("/sessions")
      .set({ Authorization: "Bearer rcwd_bogus" })
      .expect(401);
  });
});
