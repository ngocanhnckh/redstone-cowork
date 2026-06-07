import { z } from "zod";

export const AgentSessionSchema = z.object({
  id: z.string().min(1),               // Claude Code session_id
  machine: z.string().min(1),
  cwd: z.string().min(1),
  gitBranch: z.string().nullable().default(null),
  attachedAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  wrapperId: z.string().nullable().default(null),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const SessionStatusSchema = z.enum(["active", "waiting", "stale", "lost"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const NewAgentSessionSchema = AgentSessionSchema.pick({ id: true, machine: true, cwd: true, gitBranch: true, wrapperId: true });
export type NewAgentSession = z.infer<typeof NewAgentSessionSchema>;
