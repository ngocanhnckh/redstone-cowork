import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  INSTANCE_TOKEN: z.string().min(1).default("dev-token"),
  PROMPTS_DIR: z.string().default("prompts"),
  // Redstone as OIDC auth provider (org mode). All three must be set to enable it;
  // unset = personal mode only (instance-token auth, unchanged). REDSTONE_ISSUER is
  // the reachable public origin of the Redstone agent — endpoints are built from it,
  // we do NOT trust the discovery document (whose URLs may be misconfigured).
  REDSTONE_ISSUER: z.string().url().optional(),
  REDSTONE_CLIENT_ID: z.string().optional(),
  REDSTONE_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export const loadConfig = (): AppConfig => ConfigSchema.parse(process.env);

/** True when this instance is configured to authenticate org users via Redstone. */
export const redstoneEnabled = (c: AppConfig): boolean =>
  !!(c.REDSTONE_ISSUER && c.REDSTONE_CLIENT_ID && c.REDSTONE_CLIENT_SECRET);
