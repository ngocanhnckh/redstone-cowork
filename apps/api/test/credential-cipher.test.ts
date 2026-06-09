import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { CredentialCipher } from "../src/infrastructure/credential-cipher";

const key = randomBytes(32).toString("base64");

describe("CredentialCipher", () => {
  it("round-trips a secret", () => {
    const c = new CredentialCipher(key);
    const secret = "jira-pat-abc123";
    const blob = c.encrypt(secret);
    expect(blob).not.toContain(secret);
    expect(c.decrypt(blob)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const c = new CredentialCipher(key);
    expect(c.encrypt("same")).not.toBe(c.encrypt("same"));
  });

  it("fails to decrypt tampered ciphertext (GCM auth)", () => {
    const c = new CredentialCipher(key);
    const blob = c.encrypt("secret");
    const [iv, tag, ct] = blob.split(".");
    const tampered = [iv, tag, Buffer.from("xxxxxxxx").toString("base64")].join(".");
    expect(() => c.decrypt(tampered)).toThrow();
  });

  it("isConfigured reflects a valid 32-byte key", () => {
    expect(new CredentialCipher(key).isConfigured()).toBe(true);
    expect(new CredentialCipher(undefined).isConfigured()).toBe(false);
    expect(new CredentialCipher("too-short").isConfigured()).toBe(false);
  });
});
