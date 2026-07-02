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
  // bigint columns come back from pg as strings — coerce so parsing succeeds.
  messageCount: z.coerce.number().int().nonnegative().default(0),
  sizeBytes: z.coerce.number().int().nonnegative().default(0),
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

/** Approximate, city-level location of a host (from its public IP). */
export const HostGeoSchema = z.object({
  lat: z.number(),
  long: z.number(),
  city: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
});
export type HostGeo = z.infer<typeof HostGeoSchema>;

/** One telemetry sample a host agent reports (bytes/seconds coerced — may arrive as strings). */
export const HostTelemetrySchema = z.object({
  cpuPct: z.coerce.number().min(0).max(100),
  ramUsed: z.coerce.number().nonnegative(),
  ramTotal: z.coerce.number().nonnegative(),
  netRxBps: z.coerce.number().nonnegative().nullable().default(null),
  netTxBps: z.coerce.number().nonnegative().nullable().default(null),
  uptimeSec: z.coerce.number().nonnegative(),
  geo: HostGeoSchema.nullable().default(null),
});
export type HostTelemetry = z.infer<typeof HostTelemetrySchema>;

/** Server view of a host's telemetry: latest sample + short history for sparklines. */
export type HostTelemetryView = {
  hostId: string;
  machine: string;
  at: string;
  latest: HostTelemetry;
  cpuHistory: number[];
  netRxHistory: number[];
  netTxHistory: number[];
};

/** One Docker container on a host, as reported by the agent (`docker ps` + `stats`). */
export const DockerContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(), // running | exited | paused | restarting | created
  status: z.string(), // human status, e.g. "Up 2 hours (healthy)"
  ports: z.string().nullable().default(null),
  cpuPct: z.coerce.number().nullable().default(null),
  memUsed: z.coerce.number().nullable().default(null), // bytes
  memPct: z.coerce.number().nullable().default(null),
});
export type DockerContainer = z.infer<typeof DockerContainerSchema>;

export const DockerReportSchema = z.object({
  available: z.boolean().default(true), // false when docker isn't installed / no permission
  containers: z.array(DockerContainerSchema).default([]),
});
export type DockerReport = z.infer<typeof DockerReportSchema>;

/** Server view of a host's Docker state: latest snapshot + when it arrived. */
export type DockerHostView = {
  hostId: string;
  machine: string;
  at: string;
  available: boolean;
  containers: DockerContainer[];
};

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
