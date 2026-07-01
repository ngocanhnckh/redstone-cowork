import type { AgentTool } from "../../domain/agent/agent.port";
import type { RedstoneService } from "../../application/redstone.service";

/**
 * Ask the Redstone agent a question AS the authenticated user. The Redstone agent
 * has the user's own memory, integrations, and tools, so it can read their
 * Mattermost / Gmail / Jira and answer in context — use it to gather real context
 * the cockpit assistant can't see directly. Bound to one request's access token.
 */
export class RedstoneAskAgentTool implements AgentTool {
  name = "redstone_ask_agent";
  description =
    "Ask the user's Redstone agent, which runs as the user with their Mattermost, Gmail, Jira and memory. Use for questions about the user's own messages, emails, tasks, or anything needing their connected accounts (e.g. 'what did I miss on Mattermost today?', 'summarize my unread invoices'). Slow (seconds) — prefer it only when you actually need the user's live context.";
  parameters = {
    type: "object",
    properties: {
      message: { type: "string", description: "The question/instruction to send to the user's Redstone agent." },
    },
    required: ["message"],
  };

  constructor(private readonly redstone: RedstoneService, private readonly accessToken: string) {}

  async run(argsJson: string): Promise<string> {
    let message = "";
    try {
      message = String(JSON.parse(argsJson || "{}").message ?? "").trim();
    } catch {
      return "error: invalid tool arguments";
    }
    if (!message) return "error: empty message";
    try {
      const { reply } = await this.redstone.askAgent(this.accessToken, message);
      return reply || "(no reply)";
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

/** Fast, structured reads of the user's Redstone-connected data (no agent round-trip). */
export class RedstoneFetchTool implements AgentTool {
  name = "redstone_fetch";
  description =
    "Directly fetch the user's Redstone-connected data (faster and cheaper than redstone_ask_agent). Pick a source: 'integrations' (which accounts are linked), 'mattermost_inbox' (unread channels), 'gmail' (recent unread email), 'jira' (their current tasks), 'sessions' (their Redstone chat sessions).";
  parameters = {
    type: "object",
    properties: {
      source: {
        type: "string",
        enum: ["integrations", "mattermost_inbox", "gmail", "jira", "sessions"],
        description: "Which data to fetch.",
      },
    },
    required: ["source"],
  };

  private static readonly PATHS: Record<string, string> = {
    integrations: "/integrations",
    mattermost_inbox: "/mattermost/inbox",
    gmail: "/gmail/messages",
    jira: "/jira/issues",
    sessions: "/sessions",
  };

  constructor(private readonly redstone: RedstoneService, private readonly accessToken: string) {}

  async run(argsJson: string): Promise<string> {
    let source = "";
    try {
      source = String(JSON.parse(argsJson || "{}").source ?? "").trim();
    } catch {
      return "error: invalid tool arguments";
    }
    const path = RedstoneFetchTool.PATHS[source];
    if (!path) return `error: unknown source '${source}'`;
    try {
      const data = await this.redstone.fetchResource(this.accessToken, path);
      return JSON.stringify(data).slice(0, 4000);
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

/** Build the Redstone tools for a request that carries a user's access token. */
export function redstoneToolsFor(redstone: RedstoneService, accessToken: string | undefined): AgentTool[] {
  if (!redstone.enabled() || !accessToken) return [];
  return [new RedstoneAskAgentTool(redstone, accessToken), new RedstoneFetchTool(redstone, accessToken)];
}
