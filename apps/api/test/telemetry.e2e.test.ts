import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TOKEN = "tele-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("host telemetry HTTP", () => {
  let app: INestApplication;
  const srv = () => app.getHttpServer();
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  const sample = (cpu: number, rx: number) => ({
    cpuPct: cpu, ramUsed: 8_000_000_000, ramTotal: 16_000_000_000,
    netRxBps: rx, netTxBps: 1000, uptimeSec: 3600,
    geo: { lat: 34.05, long: -118.25, city: "Los Angeles", country: "US" },
  });

  it("ingests samples and returns latest + sparkline history joined with the machine name", async () => {
    await auth(request(srv()).post("/hosts")).send({ hostId: "th", machine: "orbital-01" }).expect(200);
    await auth(request(srv()).post("/hosts/th/telemetry")).send(sample(20, 100)).expect(200);
    await auth(request(srv()).post("/hosts/th/telemetry")).send(sample(55, 300)).expect(200);

    const res = await auth(request(srv()).get("/telemetry")).expect(200);
    const entry = res.body.find((e: { hostId: string }) => e.hostId === "th");
    expect(entry.machine).toBe("orbital-01");
    expect(entry.latest.cpuPct).toBe(55);
    expect(entry.latest.geo.city).toBe("Los Angeles");
    expect(entry.cpuHistory).toEqual([20, 55]);
    expect(entry.netRxHistory).toEqual([100, 300]);
  });

  it("rejects an out-of-range cpu sample and unauthenticated reads", async () => {
    await auth(request(srv()).post("/hosts/th/telemetry")).send({ ...sample(20, 100), cpuPct: 250 }).expect(400);
    await request(srv()).get("/telemetry").expect(401);
  });
});
