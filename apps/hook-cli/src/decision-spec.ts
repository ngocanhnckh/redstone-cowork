// Decision spec extraction for the notify-only handler.
//
// The implementation moved to @rcw/claude-core/tui/decision-spec so the desktop can
// build identical decision cards from a transcript `tool_use` block (whose
// {name, input} is exactly the {tool_name, tool_input} shape this consumes) without
// any hook event. Adjust it THERE.
export { buildDecisionSpec } from "@rcw/claude-core";
export type { DecisionSpec, HookEvent } from "@rcw/claude-core";
