import { z } from "zod";

/** A machine agents can open sessions on. Company servers (ownerAccountId null) are
 *  admin-assigned; a self-added VPS is owned by the agent who added it. */
export const ServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1),
  sshUser: z.string().default("root"),
  sshPort: z.number().int().positive().default(22),
  description: z.string().default(""),
  ownerAccountId: z.string().nullable().default(null),
  keyInstalled: z.boolean().default(false),
  createdBy: z.string().nullable().default(null),
  createdAt: z.coerce.date(),
  /** Populated for admin list views: usernames granted access (company servers). */
  access: z.array(z.string()).optional(),
});
export type Server = z.infer<typeof ServerSchema>;

export const NewServerSchema = z.object({
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  sshUser: z.string().min(1).max(64).default("root"),
  sshPort: z.number().int().positive().max(65535).default(22),
  description: z.string().max(500).optional(),
});
export type NewServer = z.infer<typeof NewServerSchema>;
