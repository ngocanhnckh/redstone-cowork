import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { LlmService } from "../src/application/llm.service";
import { PromptLoader } from "../src/infrastructure/prompts/prompt-loader";
import type { LlmPort, LlmCallOptions, LlmEndpoint } from "../src/domain/llm/llm.port";
import { endpointsFromEnv } from "../src/adapters/llm/endpoints-from-env";

const prompts = new PromptLoader(join(__dirname, "../../../prompts"));

const ENDPOINTS: LlmEndpoint[] = [
  { id: "text", label: "Large", baseUrl: "https://x/v1", apiKey: "k1", model: "syn:large:text", kind: "preset" },
  { id: "flash", label: "Flash", baseUrl: "https://x/v1", apiKey: "k2", model: "syn:small:text", kind: "preset" },
];

function fakeSessions(session: unknown) {
  return {
    get: vi.fn().mockResolvedValue(session),
    patchState: vi.fn().mockResolvedValue(session),
  };
}

const session = {
  id: "s1",
  transcript: [
    { role: "user", text: "add a login form" },
    { role: "assistant", text: "Added the form and wired validation." },
  ],
};

describe("LlmService", () => {
  let calls: LlmCallOptions[];
  let port: LlmPort;
  beforeEach(() => {
    calls = [];
    port = { complete: vi.fn(async (o: LlmCallOptions) => { calls.push(o); return "RESULT"; }) };
  });

  it("lists configured models without leaking keys", () => {
    const svc = new LlmService(port, ENDPOINTS, prompts, fakeSessions(session) as never);
    expect(svc.models()).toEqual([
      { id: "text", label: "Large", model: "syn:large:text", kind: "preset" },
      { id: "flash", label: "Flash", model: "syn:small:text", kind: "preset" },
    ]);
  });

  it("defaults to flash and resolves an explicit model id", async () => {
    const svc = new LlmService(port, ENDPOINTS, prompts, fakeSessions(session) as never);
    await svc.chat({ modelId: "text", messages: [{ role: "user", content: "hi" }] });
    expect(calls[0].model).toBe("syn:large:text");
    await svc.assist({ sessionId: "s1", kind: "chat", input: "what changed?" });
    expect(calls[1].model).toBe("syn:small:text"); // default → flash
  });

  it("summarize calls the model and persists the summary", async () => {
    const sessions = fakeSessions(session);
    const svc = new LlmService(port, ENDPOINTS, prompts, sessions as never);
    const text = await svc.assist({ sessionId: "s1", kind: "summarize" });
    expect(text).toBe("RESULT");
    expect(sessions.patchState).toHaveBeenCalledWith("s1", { summary: "RESULT" });
    // system prompt + the conversation as the user message
    expect(calls[0].messages[0].role).toBe("system");
    expect(calls[0].messages[1].content).toContain("add a login form");
  });

  it("optimize embeds the draft + conversation", async () => {
    const svc = new LlmService(port, ENDPOINTS, prompts, fakeSessions(session) as never);
    await svc.assist({ sessionId: "s1", kind: "optimize", input: "make it better" });
    expect(calls[0].messages[1].content).toContain("make it better");
    expect(calls[0].messages[1].content).toContain("add a login form");
  });

  it("throws when no models are configured", async () => {
    const svc = new LlmService(port, [], prompts, fakeSessions(session) as never);
    await expect(svc.chat({ modelId: "text", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow();
  });

  it("endpointsFromEnv only includes fully-configured tiers", () => {
    const env = {
      OPENAI_TEXT_BASE_URL: "https://x/v1", OPENAI_TEXT_KEY: "k", OPENAI_TEXT_MODEL: "m",
      OPENAI_FLASH_BASE_URL: "https://x/v1", OPENAI_FLASH_KEY: "k", // missing MODEL
    } as NodeJS.ProcessEnv;
    expect(endpointsFromEnv(env).map((e) => e.id)).toEqual(["text"]);
  });
});
