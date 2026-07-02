import { z } from "zod";

/** A machine running Claude Code, reporting via the `redstone agent` daemon. */
export const HostSchema = z.object({
  id: z.string().min(1), // stable per-machine UUID (~/.redstone/host-id)
  machine: z.string().min(1),
  user: z.string().nullable().default(null),
  os: z.string().nullable().default(null),
  lastSeenAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type Host = z.infer<typeof HostSchema>;

/** One Claude Code session found on a host by scanning ~/.claude/projects. */
export const DiscoveredSessionSchema = z.object({
  id: z.string().min(1), // Claude Code session id (jsonl filename)
  hostId: z.string().min(1),
  machine: z.string().min(1),
  cwd: z.string().min(1),
  folder: z.string().min(1), // basename(cwd)
  title: z.string().nullable().default(null), // first user prompt, truncated
  lastActive: z.coerce.date(),
  messageCount: z.number().int().nonnegative().default(0),
  sizeBytes: z.number().int().nonnegative().default(0),
  source: z.enum(["cowork", "external"]).default("external"),
  tags: z.array(z.string().min(1)).default([]),
  updatedAt: z.coerce.date(),
});
export type DiscoveredSession = z.infer<typeof DiscoveredSessionSchema>;

/** One session's metadata as reported by the host scanner (server derives the rest). */
export const ScannedSessionSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  title: z.string().nullable().default(null),
  lastActive: z.coerce.date(),
  messageCount: z.number().int().nonnegative().default(0),
  sizeBytes: z.number().int().nonnegative().default(0),
});
export type ScannedSession = z.infer<typeof ScannedSessionSchema>;

export const HostRegistrationSchema = z.object({
  hostId: z.string().min(1),
  machine: z.string().min(1),
  user: z.string().nullable().optional(),
  os: z.string().nullable().optional(),
});
export type HostRegistration = z.infer<typeof HostRegistrationSchema>;

export const InventoryReportSchema = z.object({
  machine: z.string().min(1),
  sessions: z.array(ScannedSessionSchema),
});
export type InventoryReport = z.infer<typeof InventoryReportSchema>;

/** A command the server queues for a host agent to execute. */
export const HostCommandKindSchema = z.enum(["passive_run", "fetch_history"]);
export type HostCommandKind = z.infer<typeof HostCommandKindSchema>;

export const HostCommandSchema = z.object({
  id: z.string().min(1),
  hostId: z.string().min(1),
  kind: HostCommandKindSchema,
  // payload: { sessionId, cwd, message? } for passive_run; { sessionId, path? } for fetch_history
  payload: z.record(z.unknown()).default({}),
  status: z.enum(["pending", "done"]).default("pending"),
  result: z.record(z.unknown()).nullable().default(null),
  createdAt: z.coerce.date(),
});
export type HostCommand = z.infer<typeof HostCommandSchema>;
