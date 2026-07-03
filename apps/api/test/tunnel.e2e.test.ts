import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module";

const TOKEN = "tunnel-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("NAT'd-host SSH relay", () => {
  let app: INestApplication;
  const srv = () => app.getHttpServer();
  const authKeysPath = join(tmpdir(), `rcwtun-authkeys-${Date.now()}.test`);

  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    process.env.RELAY_HOST = "relay.test";
    process.env.RELAY_SSH_PORT = "22";
    process.env.RCWTUN_USER = "rcwtun";
    process.env.RCWTUN_AUTHKEYS_PATH = authKeysPath;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await fs.rm(authKeysPath, { force: true });
  });

  it("provisions a host and returns relay coordinates with a port >= 30000", async () => {
    const res = await auth(request(srv()).post("/hosts/host-a/tunnel"))
      .send({ pubkey: "ssh-ed25519 AAAAkey-a" })
      .expect(200);
    expect(res.body.relayHost).toBe("relay.test");
    expect(res.body.relayPort).toBe(22);
    expect(res.body.tunnelUser).toBe("rcwtun");
    expect(res.body.tunnelPort).toBeGreaterThanOrEqual(30000);
  });

  it("GET returns the same coordinates for a provisioned host", async () => {
    const res = await auth(request(srv()).get("/hosts/host-a/tunnel")).expect(200);
    expect(res.body.tunnelPort).toBe(30000);
    expect(res.body.relayHost).toBe("relay.test");
  });

  it("404s for a host that was never provisioned", async () => {
    await auth(request(srv()).get("/hosts/nope/tunnel")).expect(404);
  });

  it("assigns a different port to a second host", async () => {
    const res = await auth(request(srv()).post("/hosts/host-b/tunnel"))
      .send({ pubkey: "ssh-ed25519 AAAAkey-b" })
      .expect(200);
    expect(res.body.tunnelPort).toBe(30001);
  });

  it("registers a cockpit key and acks", async () => {
    const res = await auth(request(srv()).post("/tunnel/cockpit-key"))
      .send({ pubkey: "ssh-ed25519 AAAAcockpit", label: "macbook" })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it("writes authorized_keys with the restricted option prefixes", async () => {
    const text = await fs.readFile(authKeysPath, "utf8");
    expect(text).toContain(`restrict,port-forwarding,permitlisten="localhost:30000" ssh-ed25519 AAAAkey-a agent:host-a`);
    expect(text).toContain(`restrict,port-forwarding,permitlisten="localhost:30001" ssh-ed25519 AAAAkey-b agent:host-b`);
    expect(text).toContain(`restrict,port-forwarding,permitopen="localhost:*" ssh-ed25519 AAAAcockpit cockpit:macbook`);
  });

  it("rejects unauthenticated access", async () => {
    await request(srv()).get("/hosts/host-a/tunnel").expect(401);
    await request(srv()).post("/tunnel/cockpit-key").send({ pubkey: "x", label: "y" }).expect(401);
  });
});
