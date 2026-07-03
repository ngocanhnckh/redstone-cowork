import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TOKEN = "claude-configs-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("Claude config profiles", () => {
  let app: INestApplication;
  const srv = () => app.getHttpServer();

  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  const env = { ANTHROPIC_BASE_URL: "https://proxy.example", ANTHROPIC_AUTH_TOKEN: "sk-secret" };

  it("upserts a profile with two env vars", async () => {
    const res = await auth(request(srv()).put("/configs/prod")).send({ env }).expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("lists the profile name only — no values", async () => {
    const res = await auth(request(srv()).get("/configs")).expect(200);
    expect(res.body).toContainEqual({ name: "prod" });
    expect(JSON.stringify(res.body)).not.toContain("sk-secret");
    expect(JSON.stringify(res.body)).not.toContain("ANTHROPIC_BASE_URL");
  });

  it("returns the decrypted env map by name", async () => {
    const res = await auth(request(srv()).get("/configs/prod")).expect(200);
    expect(res.body).toEqual({ name: "prod", env });
  });

  it("404s for an unknown profile", async () => {
    await auth(request(srv()).get("/configs/nope")).expect(404);
  });

  it("deletes a profile; subsequent GET 404s", async () => {
    await auth(request(srv()).delete("/configs/prod")).expect(200);
    await auth(request(srv()).get("/configs/prod")).expect(404);
  });

  it("rejects unauthenticated requests with 401", async () => {
    await request(srv()).get("/configs").expect(401);
  });

  it("rejects an invalid profile name with 400", async () => {
    await auth(request(srv()).put("/configs/bad%20name")).send({ env }).expect(400);
  });

  it("rejects invalid env keys with 400", async () => {
    await auth(request(srv()).put("/configs/ok")).send({ env: { "lower-case": "x" } }).expect(400);
  });
});
