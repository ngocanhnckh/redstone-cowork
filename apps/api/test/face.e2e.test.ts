import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

// Deterministic 128-d descriptors. Same base + tiny noise = "same face"; a shifted
// base = "different face" (distance >> 0.5 threshold).
function desc(base: number, jitter = 0): number[] {
  return Array.from({ length: 128 }, (_v, i) => base + Math.sin(i) * 0.01 + (i === 0 ? jitter : 0));
}

describe("face biometric sign-in", () => {
  let app: INestApplication;
  const INSTANCE = "test-instance";

  beforeEach(async () => {
    process.env.INSTANCE_TOKEN = INSTANCE;
    process.env.ADMIN_USERNAME = "anh.nguyen";
    process.env.ADMIN_PASSWORD = "admin-pass";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD;
  });

  const login = async (u: string, p: string) =>
    (await request(app.getHttpServer()).post("/auth/account/login").send({ username: u, password: p })).body.token as string;

  it("enroll returns a device secret; matching face logs in, wrong face is rejected", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    const created = await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`)
      .send({ username: "agent.face", password: "password-f1" });
    const agentTok = await login("agent.face", "password-f1");

    // enroll on this device
    const enroll = await request(app.getHttpServer()).post("/accounts/me/face/enroll")
      .set("Authorization", `Bearer ${agentTok}`).send({ descriptor: desc(0.5), deviceLabel: "Agent Mac" });
    expect(enroll.status).toBe(200);
    expect(enroll.body.deviceSecret).toMatch(/^rcwd_/);
    const deviceSecret = enroll.body.deviceSecret;

    // matching face → session
    const good = await request(app.getHttpServer()).post("/auth/face/login")
      .send({ deviceSecret, descriptor: desc(0.5, 0.02) }); // tiny jitter, same person
    expect(good.status).toBe(200);
    expect(good.body.token).toMatch(/^rcwa_/);
    expect(good.body.account.username).toBe("agent.face");

    // different face, same device → rejected
    const bad = await request(app.getHttpServer()).post("/auth/face/login")
      .send({ deviceSecret, descriptor: desc(2.0) });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("face_no-match");

    // unknown device secret → rejected
    const noDev = await request(app.getHttpServer()).post("/auth/face/login")
      .send({ deviceSecret: "rcwd_" + "0".repeat(48), descriptor: desc(0.5) });
    expect(noDev.status).toBe(401);
    expect(noDev.body.error).toBe("face_no-device");
  });

  it("face login records a 'face' audit entry", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`)
      .send({ username: "agent.audit", password: "password-a1" });
    const agentTok = await login("agent.audit", "password-a1");
    const { body } = await request(app.getHttpServer()).post("/accounts/me/face/enroll")
      .set("Authorization", `Bearer ${agentTok}`).send({ descriptor: desc(0.3) });
    await request(app.getHttpServer()).post("/auth/face/login").send({ deviceSecret: body.deviceSecret, descriptor: desc(0.3) });

    const audit = await request(app.getHttpServer()).get("/accounts/audit/logins").set("Authorization", `Bearer ${adminTok}`);
    expect(audit.body.some((e: { device: string; ok: boolean }) => e.device.includes("face") && e.ok)).toBe(true);
  });

  it("admin can pre-enroll a descriptor from a roster photo; agent cannot enroll for others", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    const created = await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`)
      .send({ username: "agent.pre", password: "password-p1" });
    const pre = await request(app.getHttpServer()).post(`/accounts/${created.body.id}/face`)
      .set("Authorization", `Bearer ${adminTok}`).send({ descriptor: desc(0.7) });
    expect(pre.status).toBe(200);

    const otherTok = await login("agent.pre", "password-p1");
    const forbidden = await request(app.getHttpServer()).post(`/accounts/${created.body.id}/face`)
      .set("Authorization", `Bearer ${otherTok}`).send({ descriptor: desc(0.7) });
    expect(forbidden.status).toBe(403);
  });

  it("admin pre-enroll + device trust (no camera) enables face login against the roster descriptor", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    const created = await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`)
      .send({ username: "agent.trust", password: "password-t1" });
    const agentTok = await login("agent.trust", "password-t1");

    // No face yet → /me reports hasFace false
    let me = await request(app.getHttpServer()).get("/accounts/me").set("Authorization", `Bearer ${agentTok}`);
    expect(me.body.hasFace).toBe(false);

    // Admin pre-enrolls a descriptor from the roster photo
    await request(app.getHttpServer()).post(`/accounts/${created.body.id}/face`)
      .set("Authorization", `Bearer ${adminTok}`).send({ descriptor: desc(0.9) });

    // Now /me reports hasFace true
    me = await request(app.getHttpServer()).get("/accounts/me").set("Authorization", `Bearer ${agentTok}`);
    expect(me.body.hasFace).toBe(true);

    // Agent trusts THIS device without a camera capture → device secret
    const trust = await request(app.getHttpServer()).post("/accounts/me/device/trust")
      .set("Authorization", `Bearer ${agentTok}`).send({ deviceLabel: "Agent Mac" });
    expect(trust.status).toBe(200);
    expect(trust.body.deviceSecret).toMatch(/^rcwd_/);

    // Face login against the ADMIN-added descriptor now works from this device
    const ok = await request(app.getHttpServer()).post("/auth/face/login")
      .send({ deviceSecret: trust.body.deviceSecret, descriptor: desc(0.9, 0.02) });
    expect(ok.status).toBe(200);
    expect(ok.body.account.username).toBe("agent.trust");

    // Device trust requires an authenticated agent
    const anon = await request(app.getHttpServer()).post("/accounts/me/device/trust").send({ deviceLabel: "x" });
    expect(anon.status).toBe(401);
  });

  it("rejects malformed descriptors (not 128 floats)", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await request(app.getHttpServer()).post("/accounts").set("Authorization", `Bearer ${adminTok}`)
      .send({ username: "agent.bad", password: "password-b1" });
    const tok = await login("agent.bad", "password-b1");
    const bad = await request(app.getHttpServer()).post("/accounts/me/face/enroll")
      .set("Authorization", `Bearer ${tok}`).send({ descriptor: [1, 2, 3] });
    expect(bad.status).toBe(400);
  });
});
