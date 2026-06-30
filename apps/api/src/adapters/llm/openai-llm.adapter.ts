import type { LlmPort, LlmCallOptions } from "../../domain/llm/llm.port";

/**
 * Calls any OpenAI-compatible /chat/completions endpoint (our infer gateway is
 * one). Keys are passed per-call from the resolved endpoint, never stored here.
 */
export class OpenAiCompatibleLlm implements LlmPort {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async complete(opts: LlmCallOptions): Promise<string> {
    const url = opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.maxTokens ?? 1024,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`llm ${res.status}: ${detail}`.slice(0, 400));
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new Error("llm: empty completion");
      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}
