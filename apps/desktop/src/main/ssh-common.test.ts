import { describe, it, expect, afterEach } from "vitest";
import { sshMuxOpts } from "./ssh-common";

const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });
const orig = process.platform;

describe("sshMuxOpts", () => {
  afterEach(() => setPlatform(orig));

  it("returns NO multiplexing options on Windows (ControlMaster is unsupported → 'Not a socket')", () => {
    setPlatform("win32");
    expect(sshMuxOpts()).toEqual([]);
  });

  it("returns ControlMaster options on macOS/Linux", () => {
    setPlatform("darwin");
    const opts = sshMuxOpts();
    expect(opts).toContain("ControlMaster=auto");
    expect(opts.join(" ")).toContain("ControlPath=");
  });
});
