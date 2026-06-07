import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  INSTANCE_TOKEN: z.string().min(1).default("dev-token"),
  PROMPTS_DIR: z.string().default("prompts"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export const loadConfig = (): AppConfig => ConfigSchema.parse(process.env);
