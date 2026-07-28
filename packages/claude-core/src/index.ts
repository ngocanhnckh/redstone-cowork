// @rcw/claude-core — pure, dependency-free logic for reading Claude Code transcripts
// and driving its terminal UI. Shared by the on-host agent (apps/hook-cli), which
// reads files locally, and the desktop's direct-SSH engine, which reads the same
// bytes over a pipe. Keeping ONE implementation is what guarantees the cockpit
// renders identically on both backends.

export type { TranscriptMessage, TodoItem, TodoStatus, Usage, ContentBlock, TranscriptLine } from "./types.js";

export {
  MAX_SUMMARY_CHARS,
  MAX_ASSISTANT_CHARS,
  TAIL_BYTES,
  MAX_TODO_SCAN_BYTES,
  renderCommandString,
  formatEditTool,
  parseRecentMessages,
  parseLastAssistantText,
  parseLatestTodos,
  latestTodoWrite,
  parseLatestUsage,
  sumUsage,
} from "./transcript/parse.js";

export { projectSlug, parseTranscriptHead, parseMarkers } from "./transcript/scan.js";
export type { TranscriptMarkers } from "./transcript/scan.js";

export { deliveryToKeys } from "./tui/keymap.js";
export { buildDecisionSpec } from "./tui/decision-spec.js";
export type { DecisionSpec, HookEvent } from "./tui/decision-spec.js";

export {
  pasteSettleMs,
  bracketedSettleMs,
  afterKeyDelay,
  KEY_SETTLE_MS,
  INTERRUPT_SETTLE_MS,
  LITERAL_CHUNK,
} from "./tui/timing.js";
