import { z } from "zod";

export const AccountRoleSchema = z.enum(["admin", "member"]);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

/** An employee/admin account on this cowork installation (never includes secrets). */
export const AccountSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().default(""),
  role: AccountRoleSchema,
  /** Agent profile (admin-managed in the roster dashboard). photo is a data URL and
   *  doubles as the pre-enrollment face source for face sign-in. */
  photo: z.string().nullable().default(null),
  level: z.string().default(""),
  division: z.string().default(""),
  email: z.string().default(""),
  jira: z.string().default(""),
  mattermost: z.string().default(""),
  phone: z.string().default(""),
  /** GitHub username (admin-editable) — source for GitHub-derived stats. */
  github: z.string().default(""),
  /** Short free-text bio shown on the agent's profile. */
  bio: z.string().default(""),
  createdAt: z.coerce.date(),
  disabledAt: z.coerce.date().nullable().default(null),
});
export type Account = z.infer<typeof AccountSchema>;

/** Admin-editable profile fields (PATCH /accounts/:id). */
export const AccountProfilePatchSchema = z.object({
  displayName: z.string().max(120).optional(),
  photo: z.string().max(1_500_000, "photo too large — resize below ~1MB").nullable().optional(),
  level: z.string().max(60).optional(),
  division: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  jira: z.string().max(120).optional(),
  mattermost: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  github: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
  role: AccountRoleSchema.optional(),
});
export type AccountProfilePatch = z.infer<typeof AccountProfilePatchSchema>;

export const NewAccountSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "letters, digits, dot, dash, underscore"),
  password: z.string().min(8, "at least 8 characters"),
  displayName: z.string().max(120).optional(),
  role: AccountRoleSchema.default("member"),
  photo: z.string().max(1_500_000).nullable().optional(),
  level: z.string().max(60).optional(),
  division: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  jira: z.string().max(120).optional(),
  mattermost: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  github: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
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

/** A 128-float face embedding (face-api.js descriptor). */
export const FaceDescriptorSchema = z.array(z.number()).length(128);
export type FaceDescriptor = z.infer<typeof FaceDescriptorSchema>;

/** Opt into face unlock on THIS device after a full login: enroll a live descriptor,
 *  receive a device secret (shown once) that pairs with the face for later sign-in. */
export const FaceEnrollSchema = z.object({
  descriptor: FaceDescriptorSchema,
  deviceLabel: z.string().max(200).optional(),
});
export type FaceEnroll = z.infer<typeof FaceEnrollSchema>;

/** Face sign-in: the device secret (possession) + a fresh live descriptor (biometric). */
export const FaceLoginSchema = z.object({
  deviceSecret: z.string().min(10),
  descriptor: FaceDescriptorSchema,
});
export type FaceLogin = z.infer<typeof FaceLoginSchema>;

/** An in-app alert for an agent: a Jira issue assigned to them was created/updated. */
export const JiraNotificationSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  issueKey: z.string(),
  summary: z.string().default(""),
  event: z.string().default(""),
  status: z.string().default(""),
  actor: z.string().default(""),
  url: z.string().default(""),
  createdAt: z.coerce.date(),
  seenAt: z.coerce.date().nullable().default(null),
});
export type JiraNotification = z.infer<typeof JiraNotificationSchema>;
