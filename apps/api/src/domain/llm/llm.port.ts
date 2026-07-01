import type { LlmMessage } from "@rcw/shared";

/** Resolved endpoint to call — a preset from env or a user-added custom endpoint. */
export type LlmEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  kind: "preset" | "custom";
  /** Per-endpoint output token cap; null/undefined → use the server default. */
  maxTokens?: number | null;
  /** Per-endpoint input/context token cap; null/undefined → use the server default. */
  maxInputTokens?: number | null;
};

export type LlmCallOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
};

/** Framework-free port for an OpenAI-compatible chat completion. */
export interface LlmPort {
  complete(opts: LlmCallOptions): Promise<string>;
}

export const LLM_PORT = Symbol("LLM_PORT");
/** Injection token for the configured endpoint list (presets from env). */
export const LLM_ENDPOINTS = Symbol("LLM_ENDPOINTS");

/** Token budgets, configurable via env, applied to every call. */
export type LlmLimits = {
  /** Max approx tokens of session context injected into a prompt (hard-capped under 100k). */
  maxContextTokens: number;
  /** Default max output tokens when an endpoint doesn't specify its own. */
  maxOutputTokens: number;
};
export const LLM_LIMITS = Symbol("LLM_LIMITS");
/** Rough chars→tokens ratio for budgeting without a tokenizer. */
export const APPROX_CHARS_PER_TOKEN = 4;
