import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for connector secrets at rest (FR-3). AES-256-GCM with a
 * single per-instance key from CRED_ENCRYPTION_KEY (base64, 32 bytes). Output is
 * "iv.tag.ciphertext", each part base64. Secrets are never logged and never
 * leave the instance; disconnect hard-deletes the row holding the ciphertext.
 */
export class CredentialCipher {
  private readonly key: Buffer | null;

  constructor(keyBase64: string | undefined = process.env.CRED_ENCRYPTION_KEY) {
    const buf = keyBase64 ? Buffer.from(keyBase64, "base64") : null;
    this.key = buf && buf.length === 32 ? buf : null;
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) throw new Error("CRED_ENCRYPTION_KEY not configured (need 32 base64-decoded bytes)");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
  }

  decrypt(blob: string): string {
    if (!this.key) throw new Error("CRED_ENCRYPTION_KEY not configured");
    const [ivB64, tagB64, ctB64] = blob.split(".");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  }
}
