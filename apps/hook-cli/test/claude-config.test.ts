import { describe, it, expect } from "vitest";
import { extractConfigFlag, parseEnvPairs } from "../src/main";
import { buildEnvPrefix, buildTmuxCommands } from "../src/claude-wrapper";

describe("extractConfigFlag", () => {
  it("extracts `--config <name>` before the command and strips both tokens", () => {
    const { configName, rest } = extractConfigFlag(["--config", "synthetic", "claude", "--resume"]);
    expect(configName).toBe("synthetic");
    expect(rest).toEqual(["claude", "--resume"]);
  });

  it("extracts `--config=<name>` form", () => {
    const { configName, rest } = extractConfigFlag(["--config=synthetic", "claude", "--resume"]);
    expect(configName).toBe("synthetic");
    expect(rest).toEqual(["claude", "--resume"]);
  });

  it("tolerates the flag appearing AFTER the command", () => {
    const { configName, rest } = extractConfigFlag(["claude", "--config", "synthetic", "--resume"]);
    expect(configName).toBe("synthetic");
    expect(rest).toEqual(["claude", "--resume"]);
  });

  it("returns undefined when no flag present and leaves args untouched", () => {
    const { configName, rest } = extractConfigFlag(["claude", "--resume"]);
    expect(configName).toBeUndefined();
    expect(rest).toEqual(["claude", "--resume"]);
  });
});

describe("parseEnvPairs", () => {
  it("parses valid KEY=VAL pairs", () => {
    expect(parseEnvPairs(["ANTHROPIC_BASE_URL=https://x", "ANTHROPIC_API_KEY=abc"])).toEqual({
      ANTHROPIC_BASE_URL: "https://x",
      ANTHROPIC_API_KEY: "abc",
    });
  });

  it("keeps `=` characters inside the value", () => {
    expect(parseEnvPairs(["FOO=a=b=c"])).toEqual({ FOO: "a=b=c" });
  });

  it("rejects lowercase / invalid keys", () => {
    expect(() => parseEnvPairs(["foo=bar"])).toThrow(/invalid env key/);
  });

  it("rejects a pair with no `=`", () => {
    expect(() => parseEnvPairs(["JUSTKEY"])).toThrow(/invalid KEY=VAL/);
  });

  it("rejects a key starting with a digit", () => {
    expect(() => parseEnvPairs(["1FOO=bar"])).toThrow(/invalid env key/);
  });
});

describe("buildEnvPrefix", () => {
  const wid = "ab12cd34";

  it("emits only the wrapper id when no auto-mode / config", () => {
    expect(buildEnvPrefix(false, wid)).toBe(`RCW_WRAPPER_ID=${wid}`);
  });

  it("adds RCW_AUTO_MODE=1 for auto mode", () => {
    expect(buildEnvPrefix(true, wid)).toBe(`RCW_WRAPPER_ID=${wid} RCW_AUTO_MODE=1`);
  });

  it("appends config env after auto-mode, single-quoting values", () => {
    const out = buildEnvPrefix(true, wid, { ANTHROPIC_BASE_URL: "https://relay.example" });
    expect(out).toBe(`RCW_WRAPPER_ID=${wid} RCW_AUTO_MODE=1 ANTHROPIC_BASE_URL='https://relay.example'`);
  });

  it("quotes values containing spaces and special chars", () => {
    const out = buildEnvPrefix(false, wid, { FOO: "a b c", BAR: "x'y" });
    expect(out).toContain("FOO='a b c'");
    expect(out).toContain("BAR='x'\\''y'");
  });

  it("config env comes after auto-mode so a profile can override it", () => {
    const out = buildEnvPrefix(true, wid, { RCW_AUTO_MODE: "0" });
    // both present, but the config-supplied one is last → wins in the shell
    expect(out.indexOf("RCW_AUTO_MODE=1")).toBeLessThan(out.lastIndexOf("RCW_AUTO_MODE"));
    expect(out.endsWith("RCW_AUTO_MODE='0'")).toBe(true);
  });
});

describe("buildTmuxCommands with configEnv", () => {
  it("injects config env into the claude command before `claude`", () => {
    const cmds = buildTmuxCommands("ab12cd34", "/tmp/p", ["--resume"], "/main.js", {
      ANTHROPIC_BASE_URL: "https://relay.example",
    });
    const newSession = cmds.find((c) => c[0] === "new-session")!;
    const joined = newSession.join(" ");
    expect(joined).toContain("ANTHROPIC_BASE_URL='https://relay.example' claude");
  });
});
