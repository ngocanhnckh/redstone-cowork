import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  type AssistRequest,
  type LlmChatRequest,
  type LlmMessage,
  type LlmModelInfo,
  type AgentSession,
} from "@rcw/shared";
import { LLM_PORT, LLM_ENDPOINTS, type LlmPort, type LlmEndpoint } from "../domain/llm/llm.port";
import { PromptLoader } from "../infrastructure/prompts/prompt-loader";
import { SessionsService } from "./sessions.service";

/** Cap how much of the transcript we feed the model — recent context matters most. */
const MAX_TRANSCRIPT_MESSAGES = 30;
const MAX_TRANSCRIPT_CHARS = 12_000;

@Injectable()
export class LlmService {
  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(LLM_ENDPOINTS) private readonly endpoints: LlmEndpoint[],
    private readonly prompts: PromptLoader,
    private readonly sessions: SessionsService,
  ) {}

  /** Models the cockpit can target, without leaking keys. */
  models(): LlmModelInfo[] {
    return this.endpoints.map((e) => ({ id: e.id, label: e.label, model: e.model, kind: e.kind }));
  }

  private resolve(modelId?: string): LlmEndpoint {
    if (this.endpoints.length === 0)
      throw new ServiceUnavailableException("No LLM models configured on the server.");
    if (modelId) {
      const found = this.endpoints.find((e) => e.id === modelId);
      if (found) return found;
    }
    // Default: prefer flash, then the first configured.
    return this.endpoints.find((e) => e.id === "flash") ?? this.endpoints[0];
  }

  private async call(endpoint: LlmEndpoint, messages: LlmMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
    return this.llm.complete({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      messages,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
    });
  }

  /** Raw chat passthrough (used by the assistant's free-form panel). */
  async chat(req: LlmChatRequest): Promise<string> {
    return this.call(this.resolve(req.modelId), req.messages);
  }

  /** Render a session's transcript into a compact, role-tagged block for prompts. */
  private formatConversation(session: AgentSession): string {
    const msgs = session.transcript.slice(-MAX_TRANSCRIPT_MESSAGES);
    let out = msgs
      .map((m) => `${m.role === "assistant" ? "Claude" : "Operator"}: ${m.text}`)
      .join("\n\n");
    if (out.length > MAX_TRANSCRIPT_CHARS) out = "…\n" + out.slice(out.length - MAX_TRANSCRIPT_CHARS);
    return out || "(no conversation yet)";
  }

  /** Built-in assistant actions, all grounded in the session conversation. */
  async assist(req: AssistRequest): Promise<string> {
    const session = await this.sessions.get(req.sessionId);
    if (!session) throw new BadRequestException("unknown session");
    const conversation = this.formatConversation(session);
    const endpoint = this.resolve(req.modelId);

    if (req.kind === "summarize") {
      const text = await this.call(
        endpoint,
        [
          { role: "system", content: this.prompts.render("llm/summarize.md", {}) },
          { role: "user", content: conversation },
        ],
        { temperature: 0.2 },
      );
      // Persist so the cockpit's Summary panel reflects it.
      await this.sessions.patchState(session.id, { summary: text });
      return text;
    }

    if (req.kind === "optimize") {
      const draft = (req.input ?? "").trim();
      if (!draft) throw new BadRequestException("nothing to optimize");
      return this.call(endpoint, [
        { role: "system", content: this.prompts.render("llm/optimize.md", {}) },
        { role: "user", content: `Session so far:\n${conversation}\n\nDraft instruction to improve:\n${draft}` },
      ]);
    }

    // chat
    const question = (req.input ?? "").trim();
    if (!question) throw new BadRequestException("empty message");
    return this.call(endpoint, [
      { role: "system", content: this.prompts.render("llm/chat.md", { conversation }) },
      { role: "user", content: question },
    ]);
  }
}
