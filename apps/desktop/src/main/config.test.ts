import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "rcw-cfg-"));
vi.mock("electron", () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from("enc:" + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
  },
}));

import { saveConfig, loadConfig, getToken, clearConfig } from "./config";

describe("desktop config store", () => {
  beforeEach(() => clearConfig());
  it("returns null before anything is saved", () => {
    expect(loadConfig()).toBeNull();
    expect(getToken()).toBeNull();
  });
  it("saves + reports hasToken without leaking the token, and round-trips getToken", () => {
    saveConfig("https://cowork.example.com", "secret-tok");
    expect(loadConfig()).toEqual({ serverUrl: "https://cowork.example.com", hasToken: true });
    expect(getToken()).toBe("secret-tok");
  });
  it("clearConfig wipes it", () => {
    saveConfig("https://x", "t");
    clearConfig();
    expect(loadConfig()).toBeNull();
  });
});
