// Decision spec extraction for the notify-only handler.
// Knows about AskUserQuestion vs permission shapes.

type Option = { label: string; description?: string };

export type DecisionSpec = {
  kind: "permission" | "question";
  title: string;
  body: Record<string, unknown>;
  options: Option[];
};

export type HookEvent = {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [k: string]: unknown;
};

/**
 * Build a DecisionSpec from a PermissionRequest hook event.
 * @param event  - the hook event
 * @param deliverable - whether the decision can be answered remotely (wrapperId is set)
 * @returns DecisionSpec or null when the event cannot produce a valid spec
 */
export function buildDecisionSpec(
  event: HookEvent,
  deliverable: boolean
): DecisionSpec | null {
  if (event.tool_name === "AskUserQuestion") {
    const questions = (event.tool_input?.questions ?? []) as Array<{
      question: string;
      options?: Option[];
    }>;
    const q = questions[0];
    if (!q) return null;
    return {
      kind: "question",
      title: q.question,
      body: { tool_input: event.tool_input, deliverable },
      options: q.options ?? [],
    };
  }

  const summary = JSON.stringify(event.tool_input ?? {}).slice(0, 160);
  return {
    kind: "permission",
    title: `${event.tool_name ?? "Tool"}: ${summary}`,
    body: { tool_name: event.tool_name, tool_input: event.tool_input, deliverable },
    options: [{ label: "Allow" }, { label: "Deny" }],
  };
}
