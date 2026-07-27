import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

describe("scoring endpoints", () => {
  let app: INestApplication;
  const INSTANCE = "test-instance";

  beforeEach(async () => {
    process.env.INSTANCE_TOKEN = INSTANCE;
    process.env.ADMIN_USERNAME = "anh.nguyen";
    process.env.ADMIN_PASSWORD = "admin-pass";
    process.env.SCORING_SCAN_DISABLED = "1";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD; delete process.env.SCORING_SCAN_DISABLED;
  });

  const srv = () => app.getHttpServer();
  const login = async (u: string, p: string) =>
    (await request(srv()).post("/auth/account/login").send({ username: u, password: p })).body.token as string;
  const mkAgent = async (adminTok: string, username: string) =>
    (await request(srv()).post("/accounts").set("Authorization", `Bearer ${adminTok}`).send({ username, password: username + "-pw1" })).body.id as string;

  it("gates /scoring/admin routes to admins, allows agents to read boards", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await mkAgent(adminTok, "agent.sc1");
    const aTok = await login("agent.sc1", "agent.sc1-pw1");

    // Admin configures a project.
    const cfg = await request(srv()).post("/scoring/admin/config/JP").set("Authorization", `Bearer ${adminTok}`)
      .send({ completeStatuses: ["Done", "Closed"], reopenPenaltyPct: 25, weekTimezone: "UTC" });
    expect(cfg.status).toBe(200);
    expect(cfg.body).toMatchObject({ projectKey: "JP", reopenPenaltyPct: 25, completeStatuses: ["Done", "Closed"] });

    // Member is forbidden from admin routes.
    const forbidden = await request(srv()).post("/scoring/admin/config/JP").set("Authorization", `Bearer ${aTok}`).send({ reopenPenaltyPct: 50 });
    expect(forbidden.status).toBe(403);
    const forbidden2 = await request(srv()).get("/scoring/admin/penalties?project=JP").set("Authorization", `Bearer ${aTok}`);
    expect(forbidden2.status).toBe(403);

    // Agent can read the (empty) board + their own score.
    const board = await request(srv()).get("/scoring/board?project=JP").set("Authorization", `Bearer ${aTok}`);
    expect(board.status).toBe(200);
    expect(board.body).toMatchObject({ projectKey: "JP", teamScore: 0, entries: [] });

    const projects = await request(srv()).get("/scoring/projects").set("Authorization", `Bearer ${aTok}`);
    expect(projects.body).toEqual([{ projectKey: "JP", enabled: true }]);
  });

  it("requires an account (instance token alone is not an agent)", async () => {
    const r = await request(srv()).get("/scoring/board?project=JP").set("Authorization", `Bearer ${INSTANCE}`);
    expect(r.status).toBe(403);
  });

  it("admin sets targets and the board reflects them", async () => {
    const adminTok = await login("anh.nguyen", "admin-pass");
    await request(srv()).post("/scoring/admin/config/JP").set("Authorization", `Bearer ${adminTok}`).send({ weekTimezone: "UTC", defaultTeamTarget: 10 });
    // pick the current week key the board will use (UTC)
    const board0 = await request(srv()).get("/scoring/board?project=JP").set("Authorization", `Bearer ${adminTok}`);
    const week = board0.body.weekKey as string;
    await request(srv()).post("/scoring/admin/targets").set("Authorization", `Bearer ${adminTok}`)
      .send({ projectKey: "JP", weekKey: week, teamTarget: 40, individualTarget: 8 });
    const board = await request(srv()).get(`/scoring/board?project=JP&week=${week}`).set("Authorization", `Bearer ${adminTok}`);
    expect(board.body).toMatchObject({ teamTarget: 40, individualTarget: 8 });
  });
});
