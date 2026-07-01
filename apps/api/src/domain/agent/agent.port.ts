/** OpenAI-style chat message, incl. tool calls / tool results for the agent loop. */
export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

/** A tool exposed to the model, in OpenAI function-tool shape. */
export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** One assistant turn: either final prose, or a batch of tool calls to run. */
export type AssistantTurn = {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
};

export type AgentChatOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: AgentMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
};

/** LLM call that can request tools — the agent loop's engine. Separate from LlmPort so simple calls stay simple. */
export interface AgentLlmPort {
  chat(opts: AgentChatOptions): Promise<AssistantTurn>;
}
export const AGENT_LLM = Symbol("AGENT_LLM");

/** A callable tool the agent can invoke. `run` receives the raw JSON arguments string. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(argsJson: string): Promise<string>;
}
export const AGENT_TOOLS = Symbol("AGENT_TOOLS");
