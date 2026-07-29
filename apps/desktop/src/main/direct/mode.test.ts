import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rcw-mode-"));
vi.mock("electron", () => ({ app: { getPath: () => tmp } }));

// The one input that used to drive everything: is a cowork server configured?
const signedIn = vi.hoisted(() => ({ value: false }));
vi.mock("../api", () => ({ isConfigured: () => signedIn.value }));

import { initMode, needsModeChoice, readChoice, resolveMode, writeChoice, wasAutoDecided } from "../mode";

const store = () => path.join(tmp, "direct-mode.json");

describe("backend selection", () => {
  beforeEach(() => {
    fs.rmSync(store(), { force: true });
    signedIn.value = false;
  });

  it("gives a fresh install Direct SSH — it needs no account and no server", () => {
    expect(initMode()).toBe("direct");
    expect(resolveMode()).toBe("direct");
  });

  // THE bug this design exists to prevent. Signing in buys team features — the
  // leaderboard, targets, shared machines. It is not a statement about where your
  // sessions come from, and it must not silently move them to another backend.
  it("keeps a fresh install on Direct SSH after the user signs in", () => {
    expect(initMode()).toBe("direct");
    signedIn.value = true; // user signs in with Jira for the leaderboard
    expect(resolveMode()).toBe("direct");
  });

  it("keeps an upgrading install on the cowork server", () => {
    // Someone who already had a working hosted setup must not have their sessions
    // vanish because a new build shipped.
    signedIn.value = true;
    expect(initMode()).toBe("cloud");
    expect(resolveMode()).toBe("cloud");
  });

  it("decides once and never revisits it", () => {
    expect(initMode()).toBe("direct");
    signedIn.value = true;
    // A second launch (or a hundred) must not re-open the question.
    expect(initMode()).toBe("direct");
    expect(initMode()).toBe("direct");
  });

  it("marks an auto decision so the UI can explain itself", () => {
    signedIn.value = true;
    initMode();
    expect(wasAutoDecided()).toBe(true);
    expect(needsModeChoice()).toBe(true);
  });

  it("stops calling it automatic once the user picks", () => {
    signedIn.value = true;
    initMode();
    writeChoice("direct", false);
    expect(readChoice()).toBe("direct");
    expect(wasAutoDecided()).toBe(false);
    expect(needsModeChoice()).toBe(false);
  });

  it("honours an explicit choice over everything else", () => {
    signedIn.value = true;
    writeChoice("direct", false);
    expect(initMode()).toBe("direct");   // does not overwrite
    expect(resolveMode()).toBe("direct");

    writeChoice("cloud", false);
    expect(resolveMode()).toBe("cloud");
  });

  it("re-decides after the choice is cleared", () => {
    signedIn.value = true;
    initMode();
    writeChoice(null);
    expect(readChoice()).toBeNull();
    signedIn.value = false;
    expect(initMode()).toBe("direct");
  });

  it("falls back sensibly if the store is unreadable", () => {
    fs.writeFileSync(store(), "{not json", "utf8");
    expect(readChoice()).toBeNull();
    expect(() => resolveMode()).not.toThrow();
    expect(resolveMode()).toBe("direct");
  });
});
