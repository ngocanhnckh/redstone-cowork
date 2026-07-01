import type { AgentTool } from "../../domain/agent/agent.port";

/**
 * Web search via Tavily (https://tavily.com). Returns ranked results with a short
 * content snippet each, plus Tavily's synthesized answer when available. The
 * agent uses the URLs here to decide what to read in full (Playwright, later).
 */
export class TavilySearchTool implements AgentTool {
  name = "web_search";
  description =
    "Search the web for current, real-world information. Returns ranked results (title, url, snippet) and a short synthesized answer. Use this whenever the question needs up-to-date facts or sources you don't already know.";
  parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      max_results: { type: "integer", description: "How many results (1–10, default 5)." },
    },
    required: ["query"],
  };

  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async run(argsJson: string): Promise<string> {
    let query = "";
    let maxResults = 5;
    try {
      const a = JSON.parse(argsJson || "{}");
      query = String(a.query ?? "").trim();
      if (Number.isFinite(a.max_results)) maxResults = Math.min(10, Math.max(1, Math.trunc(a.max_results)));
    } catch {
      return "error: invalid tool arguments";
    }
    if (!query) return "error: empty query";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await this.fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          search_depth: "basic",
          include_answer: true,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return `error: search failed (${res.status})`;
      const json = (await res.json()) as {
        answer?: string;
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const lines: string[] = [];
      if (json.answer) lines.push(`Answer: ${json.answer}`, "");
      (json.results ?? []).forEach((r, i) => {
        lines.push(`[${i + 1}] ${r.title ?? "(untitled)"}\n${r.url ?? ""}\n${(r.content ?? "").slice(0, 500)}`);
      });
      return lines.join("\n").trim() || "no results";
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      clearTimeout(timer);
    }
  }
}
