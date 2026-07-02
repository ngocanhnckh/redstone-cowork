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

  it("ingests a docker snapshot and returns it joined with the machine name", async () => {
    await auth(request(srv()).post("/hosts")).send({ hostId: "dk", machine: "docker-box" }).expect(200);
    await auth(request(srv()).post("/hosts/dk/docker")).send({
      available: true,
      containers: [
        { id: "abc123", name: "api", image: "rcw-api:latest", state: "running", status: "Up 2 hours", ports: "3001", cpuPct: 12.5, memUsed: 50_000_000, memPct: 3.1 },
        { id: "def456", name: "pg", image: "postgres:16", state: "exited", status: "Exited (0)", ports: null, cpuPct: null, memUsed: null, memPct: null },
      ],
    }).expect(200);
    const res = await auth(request(srv()).get("/telemetry/docker")).expect(200);
    const host = res.body.find((h: { hostId: string }) => h.hostId === "dk");
    expect(host.machine).toBe("docker-box");
    expect(host.available).toBe(true);
    expect(host.containers).toHaveLength(2);
    expect(host.containers[0]).toMatchObject({ name: "api", state: "running", cpuPct: 12.5 });
  });
});
