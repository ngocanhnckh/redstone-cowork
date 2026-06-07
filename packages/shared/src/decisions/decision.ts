import { z } from "zod";

export const DecisionKindSchema = z.enum(["permission", "question", "completion", "notification"]);
export const DecisionOptionSchema = z.object({ label: z.string().min(1), description: z.string().optional() });

export const ResolutionSchema = z.object({
  choice: z.string().nullable().default(null),                       // picked option label
  answers: z.record(z.string()).nullable().default(null),            // AskUserQuestion: question -> answer
  custom: z.string().nullable().default(null),                       // free-text reply
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export const NewDecisionSchema = z.object({
  sessionId: z.string().min(1),
  kind: DecisionKindSchema,
  title: z.string().min(1),
  body: z.record(z.unknown()).default({}),                           // raw hook payload subset
  options: z.array(DecisionOptionSchema).default([]),
});
export type NewDecision = z.infer<typeof NewDecisionSchema>;

export const DecisionSchema = NewDecisionSchema.extend({
  id: z.string().uuid(),
  status: z.enum(["pending", "resolved"]),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable().default(null),
  resolution: ResolutionSchema.nullable().default(null),
});
export type Decision = z.infer<typeof DecisionSchema>;
