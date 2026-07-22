import { describe, it, expect } from "vitest";
import { bestDockerHost } from "./dockerHost";
import type { DockerHostView } from "../types";

const h = (o: Partial<DockerHostView>): DockerHostView => ({
  hostId: "x", machine: "m", at: "2026-01-01T00:00:00Z", available: true, containers: [], ...o,
});

describe("bestDockerHost", () => {
  it("returns null when nothing matches (or machine is null)", () => {
    expect(bestDockerHost([h({ machine: "a" })], "b")).toBeNull();
    expect(bestDockerHost([h({ machine: "a" })], null)).toBeNull();
  });

  it("prefers an AVAILABLE report over an earlier unavailable duplicate", () => {
    const hosts = [
      h({ machine: "csd2", available: false, containers: [] }),
      h({ machine: "csd2", available: true, containers: [{ id: "1" } as never] }),
    ];
    expect(bestDockerHost(hosts, "csd2")?.available).toBe(true);
  });

  it("prefers the report with MORE containers among duplicates", () => {
    const hosts = [
      h({ machine: "yitec", containers: [] }),
      h({ machine: "yitec", containers: [{ id: "a" } as never, { id: "b" } as never] }),
    ];
    expect(bestDockerHost(hosts, "yitec")?.containers.length).toBe(2);
  });

  it("breaks a tie by freshest `at`", () => {
    const hosts = [
      h({ machine: "m", at: "2026-01-01T00:00:00Z", containers: [{ id: "a" } as never] }),
      h({ machine: "m", at: "2026-06-01T00:00:00Z", containers: [{ id: "b" } as never] }),
    ];
    expect(bestDockerHost(hosts, "m")?.at).toBe("2026-06-01T00:00:00Z");
  });

  it("does not match a different machine (renamed box needs server-side fix)", () => {
    const hosts = [h({ machine: "csd2", containers: [{ id: "a" } as never] })];
    expect(bestDockerHost(hosts, "vmi2910342")).toBeNull();
  });
});
