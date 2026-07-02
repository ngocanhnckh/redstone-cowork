import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TOKEN = "skills-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("cross-host skill sync + distribution", () => {
  let app: INestApplication;
  const srv = () => app.getHttpServer();
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("org pushes a skill via POST /skills; GET /skills shows it in the union list", async () => {
    await auth(request(srv()).post("/skills")).send({
      name: "org-skill",
      description: "Pushed by org",
      files: [{ path: "SKILL.md", content: "---\nname: org-skill\n---\nhello" }],
    }).expect(200);

    const res = await auth(request(srv()).get("/skills")).expect(200);
    const item = res.body.find((s: { name: string }) => s.name === "org-skill");
    expect(item).toBeTruthy();
    expect(item.description).toBe("Pushed by org");
    expect(item.source).toBe("org");
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uploading skill content fans out install_skill commands to hosts that lack it", async () => {
    // Two hosts registered; only host-a reports caps that already include 'shared-skill'.
    await auth(request(srv()).post("/hosts")).send({ hostId: "host-a", machine: "box-a" }).expect(200);
    await auth(request(srv()).post("/hosts")).send({ hostId: "host-b", machine: "box-b" }).expect(200);
    await auth(request(srv()).post("/hosts/host-a/caps")).send({
      skills: [{ name: "shared-skill", description: "on A", source: "personal", hash: "abc" }],
      commands: [],
    }).expect(200);
    await auth(request(srv()).post("/hosts/host-b/caps")).send({ skills: [], commands: [] }).expect(200);

    // host-a uploads the skill's full content (simulating the upload_skill response).
    await auth(request(srv()).post("/hosts/host-a/skills")).send({
      name: "shared-skill",
      description: "on A",
      source: "personal",
      hash: "abc",
      files: [{ path: "SKILL.md", content: "---\nname: shared-skill\n---\nbody" }],
    }).expect(200);

    // host-b (which lacks it) should now have a pending install_skill command.
    const cmds = await auth(request(srv()).get("/hosts/host-b/commands?timeoutMs=1")).expect(200);
    const install = cmds.body.find(
      (c: { kind: string; payload: { skill?: { name: string } } }) =>
        c.kind === "install_skill" && c.payload.skill?.name === "shared-skill",
    );
    expect(install).toBeTruthy();
    expect(install.payload.skill.files[0].path).toBe("SKILL.md");
  });

  it("rejects unauthenticated access", async () => {
    await request(srv()).get("/skills").expect(401);
  });
});
