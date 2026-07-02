import { Inject, Injectable } from "@nestjs/common";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { NewAccessKeySchema, type AccessKey, type AccessKeyScope, type CreatedAccessKey } from "@rcw/shared";
import { ACCESS_KEY_STORE, type AccessKeyStore } from "../domain/access-keys/access-key-store.port";

const hash = (key: string): string => createHash("sha256").update(key).digest("hex");

@Injectable()
export class AccessKeysService {
  constructor(@Inject(ACCESS_KEY_STORE) private readonly store: AccessKeyStore) {}

  /** Mint a new key. The plaintext is returned exactly once and never persisted. */
  async create(input: unknown): Promise<CreatedAccessKey> {
    const { name, scope } = NewAccessKeySchema.parse(input);
    const key = `rcwk_${randomBytes(24).toString("base64url")}`;
    const meta = await this.store.create({
      id: randomUUID(),
      name,
      keyHash: hash(key),
      prefix: key.slice(0, 12),
      scope,
      createdAt: new Date(),
    });
    return { ...meta, key };
  }

  /** Validate a presented bearer as an access key. Returns scope, or null if invalid/revoked. */
  async verify(token: string): Promise<{ id: string; scope: AccessKeyScope } | null> {
    if (!token.startsWith("rcwk_")) return null; // fast reject: not our key format
    const found = await this.store.findByHash(hash(token));
    if (!found || found.revokedAt) return null;
    await this.store.touch(found.id, new Date());
    return { id: found.id, scope: found.scope };
  }

  list(): Promise<AccessKey[]> { return this.store.list(); }
  revoke(id: string): Promise<boolean> { return this.store.revoke(id, new Date()); }
}
