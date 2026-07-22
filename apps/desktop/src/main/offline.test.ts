import { describe, it, expect } from "vitest";
import { parseSshConfigHosts, inferState, looksLikeClaude, parseHostScan, newSessionName } from "./offline";

describe("parseSshConfigHosts", () => {
  it("extracts Host aliases, skipping wildcards", () => {
    const cfg = `
Host prod
  HostName 10.0.0.1
Host  dev  staging
  User me
Host *.internal
  User x
Host *
  ForwardAgent yes
`;
    expect(parseSshConfigHosts(cfg)).toEqual(["prod", "dev", "staging"]);
  });
  it("dedupes and tolerates junk", () => {
    expect(parseSshConfigHosts("Host a\nHost a\nnonsense\n")).toEqual(["a"]);
  });
});

describe("inferState", () => {
  it("working when Claude shows its interrupt hint", () => {
    expect(inferState("… doing work\n(esc to interrupt)")).toBe("working");
    expect(inferState("✻ Thinking…")).toBe("working");
  });
  it("waiting on a select prompt or yes/no", () => {
    expect(inferState("Do you want to proceed?\n❯ 1. Yes\n  2. No")).toBe("waiting");
    expect(inferState("Overwrite file? (y/n)")).toBe("waiting");
  });
  it("waiting on an empty input box", () => {
    expect(inferState("╭─────────╮\n│ >       │\n╰─────────╯")).toBe("waiting");
  });
  it("idle at a shell prompt", () => {
    expect(inferState("build complete\nuser@host:~/proj$ ")).toBe("idle");
  });
});

describe("looksLikeClaude", () => {
  it("true for rcw-* tmux names regardless of content", () => {
    expect(looksLikeClaude("rcw-abc", "bash", "")).toBe(true);
  });
  it("true for a node/claude pane with Claude UI markers", () => {
    expect(looksLikeClaude("mywork", "node", "esc to interrupt · ? for shortcuts")).toBe(true);
  });
  it("false for a plain shell session", () => {
    expect(looksLikeClaude("build", "bash", "make: done\n$ ")).toBe(false);
  });
});

describe("parseHostScan", () => {
  const S = "@@RCW_SESSION@@";
  const P = "@@RCW_PANE@@";
  it("parses framed output into Claude sessions with state + transcript", () => {
    const raw =
      `${S}rcw-24798257\t1700000000\t/home/me/proj\tnode\n${P}\nsome output\n(esc to interrupt)\n` +
      `${S}build\t1700000100\t/home/me/build\tbash\n${P}\nmake: done\n$ \n`;
    const sessions = parseHostScan("csd2", "csd2", raw);
    // Only the claude session (rcw-*) is kept; the plain shell is dropped.
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.id).toBe("csd2::rcw-24798257");
    expect(s.hostAlias).toBe("csd2");
    expect(s.tmux).toBe("rcw-24798257");
    expect(s.cwd).toBe("/home/me/proj");
    expect(s.createdAt).toBe(1700000000000);
    expect(s.state).toBe("working");
    expect(s.transcript).toContain("some output");
  });
  it("returns [] for empty output", () => {
    expect(parseHostScan("h", "h", "")).toEqual([]);
  });
});

describe("newSessionName", () => {
  it("produces a valid rcw- tmux name", () => {
    expect(newSessionName(24798257)).toMatch(/^rcw-[a-z0-9]+$/);
  });
});
