import { z } from "zod";

export const LlmRoleSchema = z.enum(["system", "user", "assistant"]);
export const LlmMessageSchema = z.object({
  role: LlmRoleSchema,
  content: z.string(),
});
export type LlmMessage = z.infer<typeof LlmMessageSchema>;

/** A model the cockpit can target — a preset from server env or a user-added custom endpoint. */
export const LlmModelInfoSchema = z.object({
  id: z.string().min(1),       // stable id, e.g. "text" | "flash" | "custom:<uuid>"
  label: z.string().min(1),    // human label for the picker
  model: z.string().min(1),    // upstream model name
  kind: z.enum(["preset", "custom"]).default("preset"),
  maxTokens: z.number().int().positive().nullable().optional(),      // output cap
  maxInputTokens: z.number().int().positive().nullable().optional(), // context/input cap
});
export type LlmModelInfo = z.infer<typeof LlmModelInfoSchema>;

export const LlmChatRequestSchema = z.object({
  modelId: z.string().min(1),
  messages: z.array(LlmMessageSchema).min(1),
});
export type LlmChatRequest = z.infer<typeof LlmChatRequestSchema>;

export const LlmChatResponseSchema = z.object({ text: z.string() });
export type LlmChatResponse = z.infer<typeof LlmChatResponseSchema>;

/** The built-in assistant actions, all scoped to a session's conversation. */
export const AssistKindSchema = z.enum(["chat", "optimize", "summarize"]);
export type AssistKind = z.infer<typeof AssistKindSchema>;

export const AssistRequestSchema = z.object({
  sessionId: z.string().min(1),
  kind: AssistKindSchema,
  modelId: z.string().min(1).optional(),  // defaults to the server's default model
  /** Free-text: the user's question (chat) or the draft prompt to optimize. */
  input: z.string().optional(),
});
export type AssistRequest = z.infer<typeof AssistRequestSchema>;

export const AssistResponseSchema = z.object({ text: z.string() });
export type AssistResponse = z.infer<typeof AssistResponseSchema>;

/** Payload to add a user-defined OpenAI-compatible endpoint. */
/** The three assistant roles, each backed by an env preset that the UI can override. */
export const LlmRoleIdSchema = z.enum(["text", "flash", "vision"]);
export type LlmRoleId = z.infer<typeof LlmRoleIdSchema>;

export const LlmEndpointInputSchema = z.object({
  label: z.string().min(1).max(60),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  /** Max output tokens for this endpoint; omit to use the server default. */
  maxTokens: z.number().int().positive().max(128_000).optional(),
  /** Max input/context tokens to inject for this endpoint; omit to use the server default (hard-capped under 100k). */
  maxInputTokens: z.number().int().positive().max(100_000).optional(),
  /** Bind this endpoint to a role (text/flash/vision), overriding that env preset; omit for a standalone custom model. */
  role: LlmRoleIdSchema.optional(),
});
export type LlmEndpointInput = z.infer<typeof LlmEndpointInputSchema>;
