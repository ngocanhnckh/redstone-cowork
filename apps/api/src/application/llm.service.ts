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
import { LLM_PORT, LLM_ENDPOINTS, LLM_LIMITS, APPROX_CHARS_PER_TOKEN, type LlmPort, type LlmEndpoint, type LlmLimits } from "../domain/llm/llm.port";
import { LLM_ENDPOINT_STORE, type LlmEndpointStore } from "../domain/llm/llm-endpoint-store.port";
import { CredentialCipher } from "../infrastructure/credential-cipher";
import { PromptLoader } from "../infrastructure/prompts/prompt-loader";
import { SessionsService } from "./sessions.service";

/** Never feed more than the most recent N messages, then trim further to the token budget. */
const MAX_TRANSCRIPT_MESSAGES = 40;

@Injectable()
export class LlmService {
  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(LLM_ENDPOINTS) private readonly presets: LlmEndpoint[],
    @Inject(LLM_ENDPOINT_STORE) private readonly store: LlmEndpointStore,
    @Inject(LLM_LIMITS) private readonly limits: LlmLimits,
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
        out.push({ id: r.id, label: r.label, baseUrl: r.baseUrl, model: r.model, apiKey: this.cipher.decrypt(r.keyCipher), kind: "custom", maxTokens: r.maxTokens, maxInputTokens: r.maxInputTokens });
      } catch {
        // key rotated / corrupt cipher — skip rather than crash the model list
      }
    }
    return out;
  }

  private async allEndpoints(): Promise<LlmEndpoint[]> {
    // Presets first; a custom endpoint sharing a preset id (text/flash/vision)
    // overrides it in place, while custom:<uuid> endpoints append.
    const map = new Map<string, LlmEndpoint>();
    for (const p of this.presets) map.set(p.id, p);
    for (const c of await this.customEndpoints()) map.set(c.id, c);
    return [...map.values()];
  }

  /** Models the cockpit can target (presets + custom), without leaking keys. */
  async models(): Promise<LlmModelInfo[]> {
    return (await this.allEndpoints()).map((e) => ({ id: e.id, label: e.label, model: e.model, kind: e.kind, maxTokens: e.maxTokens ?? null, maxInputTokens: e.maxInputTokens ?? null }));
  }

  /** Public endpoint resolution for the agent loop (with keys). */
  async resolveEndpoint(modelId?: string): Promise<LlmEndpoint> {
    return this.resolve(modelId);
  }

  /** Formatted, token-capped conversation for a session; throws if unknown. `maxInputTokens` overrides the global budget. */
  async conversationForSession(sessionId: string, maxInputTokens?: number | null): Promise<string> {
    const session = await this.sessions.get(sessionId);
    if (!session) throw new BadRequestException("unknown session");
    return this.formatConversation(session, maxInputTokens);
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
    // A role-bound endpoint takes the role id (overriding that preset); otherwise a fresh custom id.
    const id = input.role ?? `custom:${randomUUID()}`;
    await this.store.create({
      id,
      label: input.label,
      baseUrl: input.baseUrl,
      model: input.model,
      keyCipher: this.cipher.encrypt(input.apiKey),
      maxTokens: input.maxTokens ?? null,
      maxInputTokens: input.maxInputTokens ?? null,
      createdAt: new Date(),
    });
    return { id, label: input.label, model: input.model, kind: "custom", maxTokens: input.maxTokens ?? null, maxInputTokens: input.maxInputTokens ?? null };
  }

  async deleteEndpoint(id: string): Promise<void> {
    // Removes a custom endpoint, or clears a role override (reverting to the env preset).
    // Deleting a bare preset id with no override stored is a harmless no-op.
    await this.store.delete(id);
  }

  private async call(endpoint: LlmEndpoint, messages: LlmMessage[], opts?: { temperature?: number }): Promise<string> {
    return this.llm.complete({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      messages,
      temperature: opts?.temperature,
      // Per-endpoint cap when set, else the server default.
      maxTokens: endpoint.maxTokens ?? this.limits.maxOutputTokens,
    });
  }

  /** Raw chat passthrough (used by the assistant's free-form panel). */
  async chat(req: LlmChatRequest): Promise<string> {
    return this.call(await this.resolve(req.modelId), req.messages);
  }

  /**
   * Render a session's transcript into a compact, role-tagged block, hard-capped
   * to the configured context-token budget (recent turns kept). Approximates
   * tokens by chars so we never ship more than ~maxContextTokens of context.
   */
  private formatConversation(session: AgentSession, maxInputTokens?: number | null): string {
    // Per-endpoint cap when given, else the server default — always hard-capped under 100k.
    const tokenBudget = Math.min(100_000, Math.max(100, maxInputTokens ?? this.limits.maxContextTokens));
    const charBudget = tokenBudget * APPROX_CHARS_PER_TOKEN;
    const msgs = session.transcript.slice(-MAX_TRANSCRIPT_MESSAGES);
    let out = msgs
      .map((m) => `${m.role === "assistant" ? "Claude" : "Operator"}: ${m.text}`)
      .join("\n\n");
    if (out.length > charBudget) out = "…(earlier context trimmed)\n" + out.slice(out.length - charBudget);
    return out || "(no conversation yet)";
  }

  /** Built-in assistant actions, all grounded in the session conversation. */
  async assist(req: AssistRequest): Promise<string> {
    const session = await this.sessions.get(req.sessionId);
    if (!session) throw new BadRequestException("unknown session");
    const endpoint = await this.resolve(req.modelId);
    const conversation = this.formatConversation(session, endpoint.maxInputTokens);

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
