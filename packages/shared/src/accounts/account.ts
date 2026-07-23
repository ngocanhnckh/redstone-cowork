import { z } from "zod";

export const AccountRoleSchema = z.enum(["admin", "member"]);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

/** An employee/admin account on this cowork installation (never includes secrets). */
export const AccountSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().default(""),
  role: AccountRoleSchema,
  createdAt: z.coerce.date(),
  disabledAt: z.coerce.date().nullable().default(null),
});
export type Account = z.infer<typeof AccountSchema>;

export const NewAccountSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "letters, digits, dot, dash, underscore"),
  password: z.string().min(8, "at least 8 characters"),
  displayName: z.string().max(120).optional(),
  role: AccountRoleSchema.default("member"),
});
export type NewAccount = z.infer<typeof NewAccountSchema>;

export const AccountLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type AccountLogin = z.infer<typeof AccountLoginSchema>;

/** Returned by login: bearer token (shown once) + the account it belongs to. */
export type AccountSession = { token: string; account: Account };

/** One sign-in attempt (success or failure) — the audit trail admins can review. */
export const LoginAuditEntrySchema = z.object({
  id: z.string().min(1),
  accountId: z.string().nullable().default(null),
  username: z.string(),
  ok: z.boolean(),
  ip: z.string().default(""),
  device: z.string().default(""),
  at: z.coerce.date(),
});
export type LoginAuditEntry = z.infer<typeof LoginAuditEntrySchema>;
