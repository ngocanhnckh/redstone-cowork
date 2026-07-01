import type { LlmPort, LlmCallOptions } from "../../domain/llm/llm.port";
import type { AgentLlmPort, AgentChatOptions, AssistantTurn } from "../../domain/agent/agent.port";

/**
 * Calls any OpenAI-compatible /chat/completions endpoint (our infer gateway is
 * one). Keys are passed per-call from the resolved endpoint, never stored here.
 * Implements both the plain completion port and the tool-calling agent port.
 */
export class OpenAiCompatibleLlm implements LlmPort, AgentLlmPort {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** Tool-calling turn: returns final prose OR the tool calls the model requested. */
  async chat(opts: AgentChatOptions): Promise<AssistantTurn> {
    const url = opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1024,
      };
      if (opts.tools?.length) {
        body.tools = opts.tools;
        body.tool_choice = "auto";
      }
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`llm ${res.status}: ${detail}`.slice(0, 400));
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      };
      const msg = json?.choices?.[0]?.message;
      const toolCalls = (msg?.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
      return { content: typeof msg?.content === "string" ? msg.content : "", toolCalls };
    } finally {
      clearTimeout(timer);
    }
  }

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
