import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { LlmService } from "../src/application/llm.service";
import { PromptLoader } from "../src/infrastructure/prompts/prompt-loader";
import { CredentialCipher } from "../src/infrastructure/credential-cipher";
import { InMemoryLlmEndpointStore } from "../src/adapters/persistence/in-memory-llm-endpoint-store";
import type { LlmPort, LlmCallOptions, LlmEndpoint } from "../src/domain/llm/llm.port";
import { endpointsFromEnv } from "../src/adapters/llm/endpoints-from-env";

const prompts = new PromptLoader(join(__dirname, "../../../prompts"));
// A real 32-byte key so encrypt/decrypt round-trips in the custom-endpoint tests.
const cipher = new CredentialCipher(Buffer.alloc(32, 7).toString("base64"));

const ENDPOINTS: LlmEndpoint[] = [
  { id: "text", label: "Large", baseUrl: "https://x/v1", apiKey: "k1", model: "syn:large:text", kind: "preset" },
  { id: "flash", label: "Flash", baseUrl: "https://x/v1", apiKey: "k2", model: "syn:small:text", kind: "preset" },
];

const make = (port: LlmPort, presets: LlmEndpoint[], sessions: unknown, store = new InMemoryLlmEndpointStore()) =>
  new LlmService(port, presets, store, cipher, prompts, sessions as never);

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

  it("lists configured models without leaking keys", async () => {
    const svc = make(port, ENDPOINTS, session);
    expect(await svc.models()).toEqual([
      { id: "text", label: "Large", model: "syn:large:text", kind: "preset" },
      { id: "flash", label: "Flash", model: "syn:small:text", kind: "preset" },
    ]);
  });

  it("defaults to flash and resolves an explicit model id", async () => {
    const svc = make(port, ENDPOINTS, fakeSessions(session));
    await svc.chat({ modelId: "text", messages: [{ role: "user", content: "hi" }] });
    expect(calls[0].model).toBe("syn:large:text");
    await svc.assist({ sessionId: "s1", kind: "chat", input: "what changed?" });
    expect(calls[1].model).toBe("syn:small:text"); // default → flash
  });

  it("summarize calls the model and persists the summary", async () => {
    const sessions = fakeSessions(session);
    const svc = make(port, ENDPOINTS, sessions);
    const text = await svc.assist({ sessionId: "s1", kind: "summarize" });
    expect(text).toBe("RESULT");
    expect(sessions.patchState).toHaveBeenCalledWith("s1", { summary: "RESULT" });
    // system prompt + the conversation as the user message
    expect(calls[0].messages[0].role).toBe("system");
    expect(calls[0].messages[1].content).toContain("add a login form");
  });

  it("optimize embeds the draft + conversation", async () => {
    const svc = make(port, ENDPOINTS, fakeSessions(session));
    await svc.assist({ sessionId: "s1", kind: "optimize", input: "make it better" });
    expect(calls[0].messages[1].content).toContain("make it better");
    expect(calls[0].messages[1].content).toContain("add a login form");
  });

  it("throws when no models are configured", async () => {
    const svc = make(port, [], session);
    await expect(svc.chat({ modelId: "text", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow();
  });

  it("adds a custom endpoint (key encrypted), lists it, routes to it, and deletes it", async () => {
    const store = new InMemoryLlmEndpointStore();
    const svc = make(port, ENDPOINTS, session, store);
    const info = await svc.addEndpoint({ label: "My GPT", baseUrl: "https://my/v1", apiKey: "sk-secret", model: "gpt-x" });
    expect(info).toMatchObject({ label: "My GPT", model: "gpt-x", kind: "custom" });
    expect(info.id).toMatch(/^custom:/);
    // stored key is ciphertext, not plaintext
    const stored = (await store.list())[0];
    expect(stored.keyCipher).not.toContain("sk-secret");
    // appears in models
    expect((await svc.models()).map((m) => m.id)).toContain(info.id);
    // routing to it decrypts the key for the call
    await svc.chat({ modelId: info.id, messages: [{ role: "user", content: "hi" }] });
    expect(calls.at(-1)).toMatchObject({ model: "gpt-x", apiKey: "sk-secret", baseUrl: "https://my/v1" });
    // delete
    await svc.deleteEndpoint(info.id);
    expect((await svc.models()).map((m) => m.id)).not.toContain(info.id);
  });

  it("refuses to delete a preset id", async () => {
    const svc = make(port, ENDPOINTS, session);
    await expect(svc.deleteEndpoint("flash")).rejects.toThrow();
  });

  it("endpointsFromEnv only includes fully-configured tiers", () => {
    const env = {
      OPENAI_TEXT_BASE_URL: "https://x/v1", OPENAI_TEXT_KEY: "k", OPENAI_TEXT_MODEL: "m",
      OPENAI_FLASH_BASE_URL: "https://x/v1", OPENAI_FLASH_KEY: "k", // missing MODEL
    } as NodeJS.ProcessEnv;
    expect(endpointsFromEnv(env).map((e) => e.id)).toEqual(["text"]);
  });
});
