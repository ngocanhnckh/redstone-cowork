import { z } from "zod";

/**
 * A named Claude endpoint config profile: a slug name + a free-form env map that
 * the host agent injects into a Claude session (e.g. ANTHROPIC_BASE_URL,
 * ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL). Values may be secrets, so the env map
 * is encrypted at rest on the cowork server and only handed back over the authed
 * channel when fetched by name.
 */

/** Profile name: a filesystem/URL-safe slug. */
export const ClaudeConfigNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9._-]+$/, "name must be a safe slug ([a-zA-Z0-9._-]+)");

/** Env var key: standard POSIX-ish env name. */
export const ClaudeConfigEnvKeySchema = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]*$/, "env keys must look like env var names ([A-Z_][A-Z0-9_]*)");

/** KEY -> VALUE string map. */
export const ClaudeConfigEnvSchema = z.record(ClaudeConfigEnvKeySchema, z.string());
export type ClaudeConfigEnv = z.infer<typeof ClaudeConfigEnvSchema>;

/** A full profile: its name + decrypted env map. */
export const ClaudeConfigProfileSchema = z.object({
  name: ClaudeConfigNameSchema,
  env: ClaudeConfigEnvSchema,
});
export type ClaudeConfigProfile = z.infer<typeof ClaudeConfigProfileSchema>;

/** Upsert body: just the env map (name comes from the path). */
export const ClaudeConfigUpsertSchema = z.object({
  env: ClaudeConfigEnvSchema,
});
export type ClaudeConfigUpsert = z.infer<typeof ClaudeConfigUpsertSchema>;

/** List entry — names only, never leaks values. */
export const ClaudeConfigSummarySchema = z.object({ name: ClaudeConfigNameSchema });
export type ClaudeConfigSummary = z.infer<typeof ClaudeConfigSummarySchema>;
