import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  type AssistRequest,
  type LlmChatRequest,
  type LlmEndpointInput,
  type LlmMessage,
  type LlmModelInfo,
  type AgentSession,
} from "@rcw/shared";
import { LLM_PORT, LLM_ENDPOINTS, type LlmPort, type LlmEndpoint } from "../domain/llm/llm.port";
import { LLM_ENDPOINT_STORE, type LlmEndpointStore } from "../domain/llm/llm-endpoint-store.port";
import { CredentialCipher } from "../infrastructure/credential-cipher";
import { PromptLoader } from "../infrastructure/prompts/prompt-loader";
import { SessionsService } from "./sessions.service";

/** Cap how much of the transcript we feed the model — recent context matters most. */
const MAX_TRANSCRIPT_MESSAGES = 30;
const MAX_TRANSCRIPT_CHARS = 12_000;

@Injectable()
export class LlmService {
  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(LLM_ENDPOINTS) private readonly presets: LlmEndpoint[],
    @Inject(LLM_ENDPOINT_STORE) private readonly store: LlmEndpointStore,
    private readonly cipher: CredentialCipher,
    private readonly prompts: PromptLoader,
    private readonly sessions: SessionsService,
  ) {}

  /** Custom endpoints from the store, decrypted; skips any that fail to decrypt. */
  private async customEndpoints(): Promise<LlmEndpoint[]> {
    const rows = await this.store.list();
    const out: LlmEndpoint[] = [];
    for (const r of rows) {
      try {
        out.push({ id: r.id, label: r.label, baseUrl: r.baseUrl, model: r.model, apiKey: this.cipher.decrypt(r.keyCipher), kind: "custom" });
      } catch {
        // key rotated / corrupt cipher — skip rather than crash the model list
      }
    }
    return out;
  }

  private async allEndpoints(): Promise<LlmEndpoint[]> {
    return [...this.presets, ...(await this.customEndpoints())];
  }

  /** Models the cockpit can target (presets + custom), without leaking keys. */
  async models(): Promise<LlmModelInfo[]> {
    return (await this.allEndpoints()).map((e) => ({ id: e.id, label: e.label, model: e.model, kind: e.kind }));
  }

  private async resolve(modelId?: string): Promise<LlmEndpoint> {
    const endpoints = await this.allEndpoints();
    if (endpoints.length === 0)
      throw new ServiceUnavailableException("No LLM models configured on the server.");
    if (modelId) {
      const found = endpoints.find((e) => e.id === modelId);
      if (found) return found;
    }
    // Default: prefer flash, then the first configured.
    return endpoints.find((e) => e.id === "flash") ?? endpoints[0];
  }

  /** Add a custom OpenAI-compatible endpoint; the key is encrypted at rest. */
  async addEndpoint(input: LlmEndpointInput): Promise<LlmModelInfo> {
    if (!this.cipher.isConfigured())
      throw new ServiceUnavailableException("CRED_ENCRYPTION_KEY not set — cannot store endpoint keys.");
    const id = `custom:${randomUUID()}`;
    await this.store.create({
      id,
      label: input.label,
      baseUrl: input.baseUrl,
      model: input.model,
      keyCipher: this.cipher.encrypt(input.apiKey),
      createdAt: new Date(),
    });
    return { id, label: input.label, model: input.model, kind: "custom" };
  }

  async deleteEndpoint(id: string): Promise<void> {
    if (!id.startsWith("custom:")) throw new BadRequestException("only custom endpoints can be removed");
    await this.store.delete(id);
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
    return this.call(await this.resolve(req.modelId), req.messages);
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
    const endpoint = await this.resolve(req.modelId);

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
