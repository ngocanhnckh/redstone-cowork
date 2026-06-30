import type { LlmEndpoint } from "../../domain/llm/llm.port";

/**
 * Build the preset endpoint list from env (mirrors the `# OPENAI LLM INFER`
 * block in .creds). Only tiers with all three vars set are included, so an
 * unconfigured server simply has no models rather than failing to boot.
 */
export function endpointsFromEnv(env: NodeJS.ProcessEnv = process.env): LlmEndpoint[] {
  const presets: Array<{ envKey: string; id: string; label: string }> = [
    { envKey: "TEXT", id: "text", label: "Large · text" },
    { envKey: "FLASH", id: "flash", label: "Flash · fast" },
    { envKey: "VISION", id: "vision", label: "Vision" },
  ];
  const out: LlmEndpoint[] = [];
  for (const { envKey, id, label } of presets) {
    const baseUrl = env[`OPENAI_${envKey}_BASE_URL`];
    const apiKey = env[`OPENAI_${envKey}_KEY`];
    const model = env[`OPENAI_${envKey}_MODEL`];
    if (baseUrl && apiKey && model) out.push({ id, label, baseUrl, apiKey, model, kind: "preset" });
  }
  return out;
}
