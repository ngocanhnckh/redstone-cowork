import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { InstanceTokenGuard, type GuardedRequest } from "../src/adapters/http/instance-token.guard";
import type { DevicesService } from "../src/application/devices.service";
import type { RedstoneService, RedstoneUser } from "../src/application/redstone.service";

const ctxFor = (req: GuardedRequest) =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;

const bearer = (t: string): GuardedRequest => ({ headers: { authorization: `Bearer ${t}` } });

const devices = (verify: (t: string) => Promise<unknown>) => ({ verify }) as unknown as DevicesService;
const redstone = (enabled: boolean, verify: (t: string) => Promise<RedstoneUser | null>) =>
  ({ enabled: () => enabled, verify }) as unknown as RedstoneService;

describe("InstanceTokenGuard", () => {
  beforeEach(() => { process.env.INSTANCE_TOKEN = "inst-tok"; });
  afterEach(() => { delete process.env.INSTANCE_TOKEN; });

  it("accepts the instance token → authKind instance", async () => {
    const g = new InstanceTokenGuard(devices(async () => null), redstone(false, async () => null));
    const req = bearer("inst-tok");
    expect(await g.canActivate(ctxFor(req))).toBe(true);
    expect(req.authKind).toBe("instance");
  });

  it("accepts a valid device token → authKind device (redstone not consulted)", async () => {
    const rVerify = vi.fn(async () => null);
    const g = new InstanceTokenGuard(devices(async () => ({ id: "d1" })), redstone(true, rVerify));
    const req = bearer("dev-tok");
    expect(await g.canActivate(ctxFor(req))).toBe(true);
    expect(req.authKind).toBe("device");
    expect(rVerify).not.toHaveBeenCalled();
  });

  it("accepts a valid Redstone token → authKind redstone, stashes token + user", async () => {
    const user: RedstoneUser = { sub: "u-1", username: "alice", email: "a@x.io", isAdmin: false };
    const g = new InstanceTokenGuard(devices(async () => null), redstone(true, async () => user));
    const req = bearer("rs-access-token");
    expect(await g.canActivate(ctxFor(req))).toBe(true);
    expect(req.authKind).toBe("redstone");
    expect(req.redstoneToken).toBe("rs-access-token");
    expect(req.redstoneUser).toEqual(user);
  });

  it("rejects an unknown token when redstone is disabled", async () => {
    const g = new InstanceTokenGuard(devices(async () => null), redstone(false, async () => null));
    await expect(g.canActivate(ctxFor(bearer("nope")))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a token that Redstone reports inactive", async () => {
    const g = new InstanceTokenGuard(devices(async () => null), redstone(true, async () => null));
    await expect(g.canActivate(ctxFor(bearer("stale")))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a missing Authorization header", async () => {
    const g = new InstanceTokenGuard(devices(async () => null), redstone(true, async () => null));
    await expect(g.canActivate(ctxFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
