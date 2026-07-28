// ⚠️ The ONLY module that knows Claude Code's terminal keystroke mappings.
//
// The implementation moved to @rcw/claude-core/tui/keymap so the desktop's direct-SSH
// engine drives the TUI with byte-identical keystrokes. Adjust it THERE — this file
// is a re-export kept so existing imports (poller, tests) are unchanged.
export { deliveryToKeys } from "@rcw/claude-core";
