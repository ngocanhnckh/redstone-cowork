import type { LlmLimits } from "../../domain/llm/llm.port";

function intEnv(v: string | undefined, def: number): number {
  const n = v != null ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Token budgets from env. Context is hard-capped under 100k so a runaway
 * transcript can never blow up the bill; output defaults small. Both tunable:
 * LLM_MAX_CONTEXT_TOKENS, LLM_MAX_OUTPUT_TOKENS.
 */
export function llmLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): LlmLimits {
  return {
    maxContextTokens: clamp(intEnv(env.LLM_MAX_CONTEXT_TOKENS, 12_000), 500, 100_000),
    maxOutputTokens: clamp(intEnv(env.LLM_MAX_OUTPUT_TOKENS, 1_024), 64, 128_000),
  };
}
