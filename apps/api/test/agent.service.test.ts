import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { AgentService } from "../src/application/agent.service";
import { PromptLoader } from "../src/infrastructure/prompts/prompt-loader";
import type { AgentLlmPort, AgentTool, AssistantTurn } from "../src/domain/agent/agent.port";

const prompts = new PromptLoader(join(__dirname, "../../../prompts"));
const LIMITS = { maxContextTokens: 12_000, maxOutputTokens: 1_024 };

const fakeLlmService = {
  resolveEndpoint: vi.fn().mockResolvedValue({ id: "text", label: "T", baseUrl: "https://x/v1", apiKey: "k", model: "m", kind: "preset" }),
  conversationForSession: vi.fn().mockResolvedValue("Operator: find X"),
};

// Redstone off by default in these tests (personal-mode agent).
const noRedstone = { enabled: () => false, verify: vi.fn() } as never;

function searchTool(calls: string[]): AgentTool {
  return {
    name: "web_search",
    description: "search",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: vi.fn(async (args: string) => { calls.push(args); return "[1] Result title\nhttps://ex.com\nsnippet"; }),
  };
}

describe("AgentService", () => {
  it("runs the tool the model asks for, feeds the result back, and returns the final answer", async () => {
    const toolCalls: string[] = [];
    // Turn 1: model requests a search. Turn 2: model answers.
    const turns: AssistantTurn[] = [
      { content: "", toolCalls: [{ id: "c1", name: "web_search", arguments: '{"query":"X"}' }] },
      { content: "Here is what I found: [source](https://ex.com)", toolCalls: [] },
    ];
    let t = 0;
    const llm: AgentLlmPort = { chat: vi.fn(async () => turns[t++]) };
    const svc = new AgentService(llm, [searchTool(toolCalls)], LIMITS, prompts, fakeLlmService as never, noRedstone);

    const res = await svc.run({ sessionId: "s1", input: "find X" });
    expect(res.text).toContain("what I found");
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0].tool).toBe("web_search");
    expect(toolCalls[0]).toContain("X"); // the tool actually ran with the model's args
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("stops at the step limit instead of looping forever", async () => {
    // Model keeps asking for tools; loop must bail after MAX_STEPS (8).
    const llm: AgentLlmPort = {
      chat: vi.fn(async () => ({ content: "still working", toolCalls: [{ id: "c", name: "web_search", arguments: "{}" }] })),
    };
    const svc = new AgentService(llm, [searchTool([])], LIMITS, prompts, fakeLlmService as never, noRedstone);
    const res = await svc.run({ sessionId: "s1", input: "loop" });
    expect(llm.chat).toHaveBeenCalledTimes(8);
    expect(res.steps.length).toBe(8);
    expect(res.text).toBeTruthy();
  });

  it("enabled() reflects whether any tool is configured", () => {
    expect(new AgentService({} as never, [], LIMITS, prompts, fakeLlmService as never, noRedstone).enabled()).toBe(false);
    expect(new AgentService({} as never, [searchTool([])], LIMITS, prompts, fakeLlmService as never, noRedstone).enabled()).toBe(true);
  });

  it("exposes Redstone tools to a signed-in org user and runs them with their token", async () => {
    const askAgent = vi.fn(async () => ({ sessionId: "s", reply: "You have 2 unread." }));
    const redstone = { enabled: () => true, askAgent, fetchResource: vi.fn() } as never;
    let sawTools: string[] = [];
    const turns: AssistantTurn[] = [
      { content: "", toolCalls: [{ id: "c1", name: "redstone_ask_agent", arguments: '{"message":"what did I miss?"}' }] },
      { content: "You missed 2 messages.", toolCalls: [] },
    ];
    let t = 0;
    const llm: AgentLlmPort = {
      chat: vi.fn(async (opts) => { sawTools = (opts.tools ?? []).map((d) => d.function.name); return turns[t++]; }),
    };
    const svc = new AgentService(llm, [], LIMITS, prompts, fakeLlmService as never, redstone);
    const res = await svc.run({ sessionId: "s1", input: "catch me up", redstoneToken: "AT" });
    expect(sawTools).toContain("redstone_ask_agent");
    expect(sawTools).toContain("redstone_fetch");
    expect(askAgent).toHaveBeenCalledWith("AT", "what did I miss?");
    expect(res.text).toContain("2 messages");
  });

  it("does NOT expose Redstone tools without a user token, even if enabled", async () => {
    const redstone = { enabled: () => true, askAgent: vi.fn(), fetchResource: vi.fn() } as never;
    let sawTools: string[] = [];
    const llm: AgentLlmPort = {
      chat: vi.fn(async (opts) => { sawTools = (opts.tools ?? []).map((d) => d.function.name); return { content: "hi", toolCalls: [] }; }),
    };
    const svc = new AgentService(llm, [], LIMITS, prompts, fakeLlmService as never, redstone);
    await svc.run({ sessionId: "s1", input: "hi" }); // no redstoneToken
    expect(sawTools).not.toContain("redstone_ask_agent");
  });

  it("handles an unknown tool name without throwing", async () => {
    const turns: AssistantTurn[] = [
      { content: "", toolCalls: [{ id: "c1", name: "nope", arguments: "{}" }] },
      { content: "done", toolCalls: [] },
    ];
    let t = 0;
    const llm: AgentLlmPort = { chat: vi.fn(async () => turns[t++]) };
    const svc = new AgentService(llm, [searchTool([])], LIMITS, prompts, fakeLlmService as never, noRedstone);
    const res = await svc.run({ sessionId: "s1", input: "x" });
    expect(res.steps[0].result).toContain("unknown tool");
    expect(res.text).toBe("done");
  });
});
