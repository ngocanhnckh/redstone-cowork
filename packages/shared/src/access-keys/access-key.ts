import { z } from "zod";

export const AccessKeyScopeSchema = z.enum(["read", "control"]);
export type AccessKeyScope = z.infer<typeof AccessKeyScopeSchema>;

/** Access key metadata (never includes the secret). */
export const AccessKeySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  prefix: z.string(),
  scope: AccessKeyScopeSchema,
  createdAt: z.coerce.date(),
  lastUsedAt: z.coerce.date().nullable().default(null),
  revokedAt: z.coerce.date().nullable().default(null),
});
export type AccessKey = z.infer<typeof AccessKeySchema>;

/** Returned exactly once, at creation — the only time the plaintext key is exposed. */
export type CreatedAccessKey = AccessKey & { key: string };

export const NewAccessKeySchema = z.object({
  name: z.string().min(1),
  scope: AccessKeyScopeSchema.default("read"),
});
export type NewAccessKey = z.infer<typeof NewAccessKeySchema>;
