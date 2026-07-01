import { Inject, Injectable } from "@nestjs/common";
import { AGENT_LLM, AGENT_TOOLS, type AgentLlmPort, type AgentMessage, type AgentTool, type ToolDef } from "../domain/agent/agent.port";
import { LLM_LIMITS, type LlmLimits } from "../domain/llm/llm.port";
import { PromptLoader } from "../infrastructure/prompts/prompt-loader";
import { LlmService } from "./llm.service";

export type AgentStep = { tool: string; args: string; result: string };
export type AgentResult = { text: string; steps: AgentStep[] };

/** Max tool-calling iterations before we stop and answer with what we have. */
const MAX_STEPS = 8;

/**
 * A minimal deep-agent loop: the model plans and calls tools (web search now,
 * page reads later); we execute each tool and feed results back until it answers.
 * Runs server-side against the Text (deep) model by default. Deliberately kept in
 * our own code — robust in this CommonJS/Alpine service where an ESM agent
 * framework would fight the build; the shape maps cleanly onto one later.
 */
@Injectable()
export class AgentService {
  constructor(
    @Inject(AGENT_LLM) private readonly llm: AgentLlmPort,
    @Inject(AGENT_TOOLS) private readonly tools: AgentTool[],
    @Inject(LLM_LIMITS) private readonly limits: LlmLimits,
    private readonly prompts: PromptLoader,
    private readonly llmService: LlmService,
  ) {}

  /** True when at least one tool is configured (e.g. Tavily key present). */
  enabled(): boolean {
    return this.tools.length > 0;
  }

  private toolDefs(): ToolDef[] {
    return this.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }

  async run(input: { sessionId: string; input: string; modelId?: string }): Promise<AgentResult> {
    // Default to the Text (deep) model — agent reasoning wants the strong one.
    const endpoint = await this.llmService.resolveEndpoint(input.modelId ?? "text");
    const conversation = await this.llmService.conversationForSession(input.sessionId, endpoint.maxInputTokens);
    const system = this.prompts.render("llm/agent.md", { conversation });

    const messages: AgentMessage[] = [
      { role: "system", content: system },
      { role: "user", content: input.input },
    ];
    const steps: AgentStep[] = [];
    let lastContent = "";

    for (let i = 0; i < MAX_STEPS; i++) {
      const turn = await this.llm.chat({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        messages,
        tools: this.toolDefs(),
        maxTokens: endpoint.maxTokens ?? this.limits.maxOutputTokens,
      });
      lastContent = turn.content || lastContent;

      if (turn.toolCalls.length === 0) {
        return { text: turn.content || "(no answer)", steps };
      }

      // Record the assistant's tool-call turn, then run each tool and feed results back.
      messages.push({
        role: "assistant",
        content: turn.content || "",
        tool_calls: turn.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
      });
      for (const tc of turn.toolCalls) {
        const tool = this.tools.find((t) => t.name === tc.name);
        let result: string;
        try {
          result = tool ? await tool.run(tc.arguments) : `error: unknown tool ${tc.name}`;
        } catch (e) {
          result = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        steps.push({ tool: tc.name, args: tc.arguments.slice(0, 400), result: result.slice(0, 600) });
      }
    }
    return { text: lastContent || "Reached the step limit before finishing.", steps };
  }
}
