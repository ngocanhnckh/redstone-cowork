import { describe, it, expect } from "vitest";
import { DevicesService } from "../src/application/devices.service";
import { InMemoryDeviceTokenStore } from "../src/adapters/persistence/in-memory-device-token-store";

const svc = () => new DevicesService(new InMemoryDeviceTokenStore());

describe("DevicesService", () => {
  it("mint returns a plaintext rcwd_ token once and stores only the hash", async () => {
    const s = svc();
    const m = await s.mint("prod-server");
    expect(m.token).toMatch(/^rcwd_/);
    expect(m.label).toBe("prod-server");
    const list = await s.list();
    expect(list[0].id).toBe(m.id);
    expect((list[0] as Record<string, unknown>).token).toBeUndefined();
    expect((list[0] as Record<string, unknown>).tokenHash).toBeUndefined();
  });
  it("verify accepts a valid token (and touches lastSeen), rejects unknown + revoked", async () => {
    const s = svc();
    const m = await s.mint("dev");
    expect(await s.verify(m.token)).toEqual({ id: m.id });
    expect(await s.verify("rcwd_nope")).toBeNull();
    await s.revoke(m.id);
    expect(await s.verify(m.token)).toBeNull();
    expect((await s.list()).length).toBe(0);
  });
});
