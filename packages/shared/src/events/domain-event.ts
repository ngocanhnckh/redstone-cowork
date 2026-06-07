import { z } from "zod";

/** Unified envelope every signal in the system normalizes into (PRD 002 FR-2 grows from this). */
export const NewDomainEventSchema = z.object({
  type: z.string().min(1),    // e.g. "worker.heartbeat", "jira.issue.updated"
  source: z.string().min(1),  // e.g. "worker", "api", "connector:jira"
  payload: z.record(z.unknown()).default({}),
});

export const DomainEventSchema = NewDomainEventSchema.extend({
  id: z.string().uuid(),
  occurredAt: z.coerce.date(),
});

export type NewDomainEvent = z.infer<typeof NewDomainEventSchema>;
export type DomainEvent = z.infer<typeof DomainEventSchema>;
