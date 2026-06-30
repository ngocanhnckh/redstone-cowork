import { hostname } from "node:os";
import { loadCliConfig } from "./config";
import { ApiClient } from "./api-client";
import { isArmed as isArmedFs, disarm as disarmFs } from "./state";
import { buildDecisionSpec } from "./decision-spec";
import { readLastAssistantText, readRecentMessages, readLatestTodos } from "./transcript";

export type HookEvent = {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  permission_mode?: string;
  transcript_path?: string;
  [k: string]: unknown;
};

export type Deps = {
  api: Pick<
    ApiClient,
    "heartbeat" | "attach" | "createDecision" | "resolveLocal" | "pushState"
  >;
  isArmed: (cwd: string) => boolean;
  disarm: (cwd: string) => void;
  machine: string;
  wrapperId: string | null;
  autoModeEnabled: boolean;
  /** Latest assistant prose from the session transcript — the context the user saw. */
  lastAssistantText: (event: HookEvent) => string | null;
  /** Recent user prompts + assistant prose from the transcript tail. */
  recentMessages: (event: HookEvent) => import("@rcw/shared").TranscriptMessage[];
  /** Claude's current to-do list (latest TodoWrite) from the transcript. */
  latestTodos: (event: HookEvent) => import("@rcw/shared").TodoItem[];
};

export async function processEvent(
  event: HookEvent,
  deps: Deps
): Promise<object | null> {
  try {
    if (deps.wrapperId) {
      // Wrapper-launched: ALWAYS (re)link this session to the CURRENT wrapper run.
      // Essential for `claude --continue`/`--resume`, which reuse an existing
      // session id that may still point at a previous (now-dead) wrapper. Skipping
      // this on a "known" session would leave wrapper_id stale, so the live poller
      // (polling the current wrapper id) never sees the session's deliveries.
      // attach() upserts: refreshes wrapper_id + last_seen, preserves attachedAt.
      await deps.api.attach({
        id: event.session_id,
        machine: deps.machine,
        cwd: event.cwd,
        gitBranch: null,
        wrapperId: deps.wrapperId,
        permissionMode: event.permission_mode ?? null,
        autoModeEnabled: deps.autoModeEnabled,
      });
    } else {
      const known = await deps.api.heartbeat(event.session_id);
      if (!known) {
        if (deps.isArmed(event.cwd)) {
          // armed (`redstone hook`) session attaches and disarms
          await deps.api.attach({
            id: event.session_id,
            machine: deps.machine,
            cwd: event.cwd,
            gitBranch: null,
            wrapperId: null,
            permissionMode: event.permission_mode ?? null,
            autoModeEnabled: deps.autoModeEnabled,
          });
          deps.disarm(event.cwd);
        } else {
          // Not ours — stay silent
          return null;
        }
      }
    }

    // PostToolUse pushes the latest prose as Claude works through tools — the cockpit
    // would otherwise show nothing between a reply and the final Stop (feels frozen).
    if (["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "Notification", "PermissionRequest"].includes(event.hook_event_name)) {
      // Claude is mid-turn from prompt-submit through tool runs, and stops at Stop.
      // Notification / PermissionRequest mean it's blocked waiting on the user, not working.
      const working =
        event.hook_event_name === "UserPromptSubmit" ||
        event.hook_event_name === "PostToolUse";
      await deps.api.pushState(event.session_id, {
        latestAnswer: deps.lastAssistantText(event),
        transcript: deps.recentMessages(event),
        todos: deps.latestTodos(event),
        working,
      });
    }

    switch (event.hook_event_name) {
      case "Stop":
        await deps.api.createDecision({
          sessionId: event.session_id,
          kind: "completion",
          title: "Claude finished a task",
          body: { lastMessage: deps.lastAssistantText(event) },
          options: [],
        });
        return null;

      case "Notification": {
        const message = String((event as { message?: unknown }).message ?? "");
        if (!message) return null;
        await deps.api.createDecision({
          sessionId: event.session_id,
          kind: "notification",
          title: message.slice(0, 200),
          body: { message, lastMessage: deps.lastAssistantText(event) },
          options: [],
        });
        return null;
      }

      case "PostToolUse":
        // User answered at the terminal — auto-resolve any pending permission/question cards
        await deps.api.resolveLocal(event.session_id);
        return null;

      case "PermissionRequest": {
        const deliverable = !!deps.wrapperId;
        const spec = buildDecisionSpec(event, deliverable);
        if (!spec) return null;
        // Attach the prose the user just saw so the web card carries context.
        const body = { ...spec.body, lastMessage: deps.lastAssistantText(event) };
        // Await decision creation; errors flow to outer try/catch
        await deps.api.createDecision({ sessionId: event.session_id, ...spec, body });
        return null;
      }

      default:
        // SessionStart / UserPromptSubmit / SessionEnd: heartbeat was enough
        return null;
    }
  } catch {
    // NEVER break the session
    return null;
  }
}

export async function handle(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  let event: HookEvent;
  try {
    event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return;
  }
  const cfg = loadCliConfig();
  if (!cfg) return;
  const wrapperId = process.env.RCW_WRAPPER_ID ?? null;
  const autoModeEnabled = process.env.RCW_AUTO_MODE === "1";
  const out = await processEvent(event, {
    api: new ApiClient(cfg),
    isArmed: isArmedFs,
    disarm: disarmFs,
    machine: hostname(),
    wrapperId,
    autoModeEnabled,
    lastAssistantText: (e) => readLastAssistantText(e.transcript_path),
    recentMessages: (e) => readRecentMessages(e.transcript_path),
    latestTodos: (e) => readLatestTodos(e.transcript_path),
  });
  if (out) process.stdout.write(JSON.stringify(out));
}
