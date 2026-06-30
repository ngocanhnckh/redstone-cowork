import type { LlmMessage } from "@rcw/shared";

/** Resolved endpoint to call — a preset from env or a user-added custom endpoint. */
export type LlmEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  kind: "preset" | "custom";
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
