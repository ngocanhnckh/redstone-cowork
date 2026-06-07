import { hostname } from "node:os";
import { loadCliConfig } from "./config";
import { ApiClient } from "./api-client";
import { isArmed as isArmedFs, disarm as disarmFs } from "./state";
import { buildDecisionSpec } from "./decision-spec";

export type HookEvent = {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [k: string]: unknown;
};

export type Deps = {
  api: Pick<
    ApiClient,
    "heartbeat" | "attach" | "createDecision" | "resolveLocal"
  >;
  isArmed: (cwd: string) => boolean;
  disarm: (cwd: string) => void;
  machine: string;
  wrapperId: string | null;
};

export async function processEvent(
  event: HookEvent,
  deps: Deps
): Promise<object | null> {
  try {
    const known = await deps.api.heartbeat(event.session_id);
    if (!known) {
      // Attach if we have a wrapperId OR if the session is armed
      if (deps.wrapperId) {
        // wrapper sessions attach without requiring arming
        await deps.api.attach({
          id: event.session_id,
          machine: deps.machine,
          cwd: event.cwd,
          gitBranch: null,
          wrapperId: deps.wrapperId,
        });
      } else if (deps.isArmed(event.cwd)) {
        // armed sessions attach and disarm
        await deps.api.attach({
          id: event.session_id,
          machine: deps.machine,
          cwd: event.cwd,
          gitBranch: null,
          wrapperId: null,
        });
        deps.disarm(event.cwd);
      } else {
        // Not ours — stay silent
        return null;
      }
    }

    switch (event.hook_event_name) {
      case "Stop":
        await deps.api.createDecision({
          sessionId: event.session_id,
          kind: "completion",
          title: "Claude finished a task",
          body: {},
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
          body: { message },
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
        // Await decision creation; errors flow to outer try/catch
        await deps.api.createDecision({ sessionId: event.session_id, ...spec });
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
  const out = await processEvent(event, {
    api: new ApiClient(cfg),
    isArmed: isArmedFs,
    disarm: disarmFs,
    machine: hostname(),
    wrapperId,
  });
  if (out) process.stdout.write(JSON.stringify(out));
}
