import { z } from "zod";

export const TodoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export const TodoItemSchema = z.object({
  text: z.string().min(1),
  status: TodoStatusSchema.default("pending"),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TranscriptMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;

export const SessionStatePatchSchema = z
  .object({
    latestAnswer: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    todos: z.array(TodoItemSchema).optional(),
    transcript: z.array(TranscriptMessageSchema).optional(),
    /** True while Claude is mid-turn (prompt submitted / running tools), false once it stops. */
    working: z.boolean().optional(),
  })
  .strict();
export type SessionStatePatch = z.infer<typeof SessionStatePatchSchema>;

export const AgentSessionSchema = z.object({
  id: z.string().min(1),               // Claude Code session_id
  machine: z.string().min(1),
  cwd: z.string().min(1),
  gitBranch: z.string().nullable().default(null),
  attachedAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  wrapperId: z.string().nullable().default(null),
  permissionMode: z.string().nullable().default(null),
  autoModeEnabled: z.boolean().default(false),
  latestAnswer: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  todos: z.array(TodoItemSchema).default([]),
  transcript: z.array(TranscriptMessageSchema).default([]),
  working: z.boolean().default(false),
  pinned: z.boolean().default(false),
  snoozedUntil: z.coerce.date().nullable().default(null),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const SessionStatusSchema = z.enum(["active", "waiting", "stale", "lost"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const NewAgentSessionSchema = AgentSessionSchema.pick({
  id: true, machine: true, cwd: true, gitBranch: true, wrapperId: true,
  permissionMode: true, autoModeEnabled: true,
});
export type NewAgentSession = z.infer<typeof NewAgentSessionSchema>;
