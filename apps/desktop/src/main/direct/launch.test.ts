import { describe, it, expect } from "vitest";
import { buildLaunchCommand } from "../ssh-install";

/** The command is base64'd into `echo <b64> | base64 -d | bash -l`; decode to inspect it. */
function decode(cmd: string): string {
  const m = /echo ([A-Za-z0-9+/=]+) \| base64 -d/.exec(cmd);
  if (!m) throw new Error("not a base64-wrapped command");
  return Buffer.from(m[1], "base64").toString("utf8");
}

describe("buildLaunchCommand — direct (agent-free)", () => {
  const direct = decode(buildLaunchCommand({ folder: "/srv/app", danger: false, direct: true }));

  it("requires nothing to be installed by us", () => {
    // The whole point of the offline edition: launching a session must not depend on
    // an agent, a bundle, or a poller.
    expect(direct).not.toContain("command -v redstone");
    expect(direct).not.toContain("redstone hook");
    expect(direct).not.toContain("redstone.js");
    expect(direct).not.toContain("poll --wrapper");
  });

  it("still starts the same tmux session the cockpit expects", () => {
    expect(direct).toContain("tmux new-session -d -s");
    expect(direct).toContain('S="rcw-$ID"');          // same naming, so wrapperId still resolves
    expect(direct).toContain('echo "RCW_STARTED $S"'); // same success marker the handler parses
    expect(direct).toContain("tmux set-option -t \"$S\" status off");
    expect(direct).toContain("set-clipboard on");      // OSC 52 copy still works
  });

  it("checks for the user's own tools and names the missing one honestly", () => {
    expect(direct).toContain("command -v tmux");
    expect(direct).toContain("command -v claude");
    // "redstone not installed" would be a lie here — nothing of ours needs installing.
    expect(direct).toMatch(/tmux is not installed on this host/);
    expect(direct).toMatch(/claude is not installed on this host/);
  });

  it("pre-accepts folder trust, or the session never becomes visible", () => {
    expect(direct).toContain("hasTrustDialogAccepted");
  });

  it("still sources ~/.redstone/env — that's the user's toolchain, not an agent", () => {
    // A host onboarded by the hosted edition keeps its private Node/tmux/Claude there.
    expect(direct).toContain('[ -f "$HOME/.redstone/env" ] && . "$HOME/.redstone/env"');
  });

  it("passes resume and danger flags through", () => {
    const resumed = decode(buildLaunchCommand({
      folder: "/srv/app", danger: true, resumeId: "abc-123", direct: true,
    }));
    expect(resumed).toContain("--resume abc-123");
    expect(resumed).toContain("--dangerously-skip-permissions");
  });

  it("sanitises the resume id so it can't inject shell", () => {
    const nasty = decode(buildLaunchCommand({
      folder: "/srv/app", danger: false, resumeId: "abc; rm -rf /", direct: true,
    }));
    expect(nasty).not.toContain("rm -rf /");
    expect(nasty).toContain("--resume abcrm-rf");
  });

  it("quotes the folder so spaces and quotes can't break the script", () => {
    const spaced = decode(buildLaunchCommand({
      folder: "/srv/my app's dir", danger: false, direct: true,
    }));
    expect(spaced).toContain(`FOLDER='/srv/my app'\\''s dir'`);
  });
});

describe("buildLaunchCommand — hosted (unchanged)", () => {
  const hosted = decode(buildLaunchCommand({ folder: "/srv/app", danger: false }));

  it("still requires and uses the agent", () => {
    // The hosted edition must be byte-for-byte unaffected by the direct path existing.
    expect(hosted).toContain("command -v redstone");
    expect(hosted).toContain("redstone hook");
    expect(hosted).toContain("poll --wrapper");
    expect(hosted).toContain("redstone.js");
  });

  it("is what you get when `direct` is absent or false", () => {
    const explicit = decode(buildLaunchCommand({ folder: "/srv/app", danger: false, direct: false }));
    expect(explicit).toBe(hosted);
  });
});
