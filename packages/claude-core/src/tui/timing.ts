// ⚠️ Timing constants for driving the Claude Code TUI via tmux. Extracted verbatim
// from apps/hook-cli/src/poller.ts so the hosted agent and the direct (agent-free)
// desktop use identical pacing.
//
// IMPORTANT for the direct edition: these sleeps must be executed on the REMOTE
// side (inside one `tmux.deliver` command), not by awaiting between round trips
// from the desktop. Adding a network RTT to each gap makes the settle
// non-deterministic over a slow link, which is exactly the "typed but not sent"
// failure mode the comments below describe.

/**
 * Delay between pasting literal text and pressing Enter.
 *
 * Claude Code's TUI runs a paste-detection heuristic: a fast burst of characters
 * is buffered as a "paste" and the input settles a few ms later. An Enter that
 * arrives during that window is swallowed into the paste as a newline instead of
 * submitting. Short text never trips the heuristic (works at 0ms); long text does.
 * Scale the wait to text length so the buffer has settled before we submit.
 */
export function pasteSettleMs(text: string): number {
  return Math.min(1500, 250 + text.length * 3);
}

/**
 * Small gap between ordinary keystrokes (e.g. an option digit and its Enter, or
 * the Down-walk + Enter that drives a multi-question AskUserQuestion form). Each
 * keystroke can trigger a panel transition (question → next question → review
 * screen) that must finish rendering before the next key lands, so keep a little
 * headroom above a bare frame.
 */
export const KEY_SETTLE_MS = 180;

/**
 * Gap after an Escape (interrupt) before the next keystroke. Aborting a turn —
 * stopping a stream or a running tool and returning to the input prompt — takes
 * noticeably longer than a normal key press, and a replacement instruction typed
 * too early would land mid-teardown and be lost. Give Claude time to settle.
 */
export const INTERRUPT_SETTLE_MS = 650;

/**
 * Max length of a single `tmux send-keys -l` literal. tmux rejects an
 * over-long command ("command too long"), so a large paste (e.g. a console
 * stack trace) must be split into several send-keys calls that concatenate
 * into the same input buffer.
 */
export const LITERAL_CHUNK = 480;

/**
 * Settle after a BRACKETED PASTE before the submitting Enter. Unlike the
 * length-scaled `pasteSettleMs` guess, bracketed paste is atomic + delimited, so the
 * Enter can't be absorbed — we only need the TUI a frame or two to render the pasted
 * block (Claude collapses a big paste into a "[Pasted text]" placeholder) before
 * submitting. Small + gently scaled, capped low.
 */
export function bracketedSettleMs(text: string): number {
  return Math.min(450, 120 + Math.floor(text.length / 40));
}

/** How long to wait after a given send-keys sequence before the next one. */
export function afterKeyDelay(keys: string[]): number {
  if (keys[0] === "-l") return pasteSettleMs(keys[1] ?? "");
  if (keys[0] === "Escape") return INTERRUPT_SETTLE_MS;
  return KEY_SETTLE_MS;
}
