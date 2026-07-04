import { describe, it, expect } from "vitest";
import { githubWebUrl } from "./git";

describe("githubWebUrl", () => {
  it("normalizes the ssh/scp remote form", () => {
    expect(githubWebUrl("git@github.com:ngocanhnckh/redstone-cowork.git")).toBe(
      "https://github.com/ngocanhnckh/redstone-cowork"
    );
  });

  it("normalizes the https remote form (strips .git)", () => {
    expect(githubWebUrl("https://github.com/ngocanhnckh/redstone-cowork.git")).toBe(
      "https://github.com/ngocanhnckh/redstone-cowork"
    );
  });

  it("keeps an https remote without .git", () => {
    expect(githubWebUrl("https://github.com/o/r")).toBe("https://github.com/o/r");
  });

  it("supports GitHub Enterprise hosts", () => {
    expect(githubWebUrl("git@github.acme.com:team/app.git")).toBe(
      "https://github.acme.com/team/app"
    );
  });

  it("returns null for non-github remotes", () => {
    expect(githubWebUrl("git@gitlab.com:o/r.git")).toBeNull();
    expect(githubWebUrl("https://bitbucket.org/o/r.git")).toBeNull();
  });

  it("returns null for empty or unparseable input", () => {
    expect(githubWebUrl("")).toBeNull();
    expect(githubWebUrl("   ")).toBeNull();
  });
});
