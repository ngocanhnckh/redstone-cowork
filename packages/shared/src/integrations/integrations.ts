import { z } from "zod";

export const ConnectorKindSchema = z.enum(["jira", "mattermost", "google", "microsoft"]);
export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;

/** FR-2 — the unified event envelope every connector normalizes into. */
export const IngestedEventSchema = z.object({
  source: z.string().min(1), // e.g. "jira", "mattermost"
  sourceId: z.string().min(1), // stable id within the source (issue key, post id, …)
  type: z.string().min(1), // e.g. "jira.issue.updated", "mattermost.mention"
  occurredAt: z.coerce.date(),
  actor: z.string().nullable().default(null),
  payload: z.record(z.unknown()).default({}),
  links: z.array(z.record(z.unknown())).default([]),
});
export type IngestedEvent = z.infer<typeof IngestedEventSchema>;

export const ConnectionStatusSchema = z.enum(["connected", "erroring", "disabled"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** Public view of a connection — never carries the secret. */
export const ConnectionSchema = z.object({
  id: z.string().uuid(),
  kind: ConnectorKindSchema,
  endpoint: z.string(),
  label: z.string().nullable().default(null),
  status: ConnectionStatusSchema,
  lastSyncAt: z.coerce.date().nullable().default(null),
  lastError: z.string().nullable().default(null),
  config: z.record(z.unknown()).default({}),
});
export type Connection = z.infer<typeof ConnectionSchema>;

/** Inbound payload to create a connection — token is accepted here only, never returned. */
export const NewConnectionSchema = z.object({
  kind: ConnectorKindSchema,
  endpoint: z.string().min(1),
  token: z.string().min(1),
  label: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});
export type NewConnection = z.infer<typeof NewConnectionSchema>;
