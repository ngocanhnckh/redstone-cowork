import { describe, it, expect } from "vitest";
import { shq, buildTmuxCommands } from "../src/claude-wrapper";

describe("shq", () => {
  it("leaves a simple arg unchanged inside single quotes", () => {
    expect(shq("hello")).toBe("'hello'");
  });

  it("escapes single quotes inside the argument", () => {
    // O'Reilly -> 'O'\''Reilly'
    expect(shq("O'Reilly")).toBe("'O'\\''Reilly'");
  });

  it("wraps arg with spaces in single quotes", () => {
    expect(shq("hello world")).toBe("'hello world'");
  });
});

describe("buildTmuxCommands", () => {
  const wrapperId = "ab12cd34";
  const cwd = "/home/user/myproject";
  const args = ["--model", "claude-opus-4-5"];
  const mainBin = "/usr/local/lib/node/main.js";

  it("returns an array of tmux arg-arrays", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    expect(Array.isArray(cmds)).toBe(true);
    expect(cmds.length).toBeGreaterThanOrEqual(4);
  });

  it("session name is rcw-<wrapperId>", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    const newSession = cmds.find((c) => c[0] === "new-session");
    expect(newSession).toBeDefined();
    expect(newSession).toContain(`rcw-${wrapperId}`);
  });

  it("new-session includes RCW_WRAPPER_ID env in the claude command", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    const newSession = cmds.find((c) => c[0] === "new-session");
    const joined = newSession!.join(" ");
    expect(joined).toContain(`RCW_WRAPPER_ID=${wrapperId}`);
  });

  it("new-session uses -c <cwd>", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    const newSession = cmds.find((c) => c[0] === "new-session");
    expect(newSession).toBeDefined();
    const cidx = newSession!.indexOf("-c");
    expect(cidx).toBeGreaterThan(-1);
    expect(newSession![cidx + 1]).toBe(cwd);
  });

  it("set-option turns status off", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    const setOpt = cmds.find((c) => c[0] === "set-option");
    expect(setOpt).toBeDefined();
    expect(setOpt).toContain("status");
    expect(setOpt).toContain("off");
  });

  it("hidden poll window passes --wrapper and --tmux args to main.js poll", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    const newWindow = cmds.find((c) => c[0] === "new-window");
    expect(newWindow).toBeDefined();
    const joined = newWindow!.join(" ");
    expect(joined).toContain("--wrapper");
    expect(joined).toContain(wrapperId);
    expect(joined).toContain("--tmux");
    expect(joined).toContain(`rcw-${wrapperId}:0`);
    expect(joined).toContain(mainBin);
    expect(joined).toContain("poll");
  });

  it("attach command targets :0", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    const attach = cmds.find((c) => c[0] === "attach");
    expect(attach).toBeDefined();
    expect(attach!.join(" ")).toContain(`rcw-${wrapperId}:0`);
  });

  it("kill-session command targets the session", () => {
    const cmds = buildTmuxCommands(wrapperId, cwd, args, mainBin);
    const kill = cmds.find((c) => c[0] === "kill-session");
    expect(kill).toBeDefined();
    expect(kill).toContain(`rcw-${wrapperId}`);
  });
});
