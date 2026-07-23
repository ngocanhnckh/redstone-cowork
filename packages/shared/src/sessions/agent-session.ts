import { z } from "zod";
import { JiraBindingSchema } from "../jira/jira.js";

export const TodoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export const TodoItemSchema = z.object({
  text: z.string().min(1),
  status: TodoStatusSchema.default("pending"),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

/** One cumulative token-spend sample over the session's lifetime (for the chart). */
export const TokenSampleSchema = z.object({
  t: z.coerce.date(),
  input: z.coerce.number().nonnegative(),
  output: z.coerce.number().nonnegative(),
});
export type TokenSample = z.infer<typeof TokenSampleSchema>;

/** A user-managed checklist item (distinct from Claude's auto-derived plan todos). */
export const UserTodoSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  done: z.boolean().default(false),
});
export type UserTodo = z.infer<typeof UserTodoSchema>;

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
    /** Current context-window size in tokens (last request's input + cache tokens). */
    contextTokens: z.number().int().nonnegative().nullable().optional(),
    /** The model id from the latest turn (used to pick the context-window limit). */
    model: z.string().nullable().optional(),
    /** Cumulative token spend so far (from the hook's full-transcript scan on Stop). */
    tokensInput: z.number().int().nonnegative().optional(),
    tokensOutput: z.number().int().nonnegative().optional(),
    /** Server-appended time-series (not sent by the hook). */
    tokenSeries: z.array(TokenSampleSchema).optional(),
    /** Soft-close timestamp: when set, the session is retired and hidden from lists. */
    closedAt: z.coerce.date().nullable().optional(),
    /** Per-session Jira binding (profile + project); null clears it. */
    jira: JiraBindingSchema.nullable().optional(),
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
  userTodos: z.array(UserTodoSchema).default([]),
  /** User-applied labels for organizing/filtering sessions. */
  tags: z.array(z.string().min(1)).default([]),
  transcript: z.array(TranscriptMessageSchema).default([]),
  working: z.boolean().default(false),
  contextTokens: z.coerce.number().int().nonnegative().nullable().default(null),
  model: z.string().nullable().default(null),
  tokensInput: z.coerce.number().int().nonnegative().default(0),
  tokensOutput: z.coerce.number().int().nonnegative().default(0),
  tokenSeries: z.array(TokenSampleSchema).default([]),
  /** Owning account (enterprise mode). Null only until claimed at seed/attach. */
  accountId: z.string().nullable().default(null),
  pinned: z.boolean().default(false),
  snoozedUntil: z.coerce.date().nullable().default(null),
  /** Soft-close timestamp: closed sessions keep their history but drop out of the cockpit. */
  closedAt: z.coerce.date().nullable().default(null),
  /** Per-session Jira binding (which profile + project to read), or null. */
  jira: JiraBindingSchema.nullable().default(null),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const SessionStatusSchema = z.enum(["active", "waiting", "stale", "lost"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const NewAgentSessionSchema = AgentSessionSchema.pick({
  id: true, machine: true, cwd: true, gitBranch: true, wrapperId: true,
  permissionMode: true, autoModeEnabled: true,
});
export type NewAgentSession = z.infer<typeof NewAgentSessionSchema>;
