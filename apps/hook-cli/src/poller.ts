import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deliveryToKeys } from "./keymap";
import type { ApiClient } from "./api-client";

const execFileP = promisify(execFile);

type Delivery = Parameters<typeof deliveryToKeys>[0] & { id: string };

/**
 * Flat dependency shape for pollOnce — easy to mock in tests.
 */
export type PollOnceDeps = {
  /** Fetch pending deliveries (long-polls on the server side). */
  deliveries(): Promise<Delivery[]>;
  /** Mark a delivery as consumed so it won't be returned again. */
  markDelivered(id: string): Promise<void>;
  /** Execute a single send-keys argument list against the tmux target. */
  sendKeys(keys: string[]): Promise<void>;
  /** Pause (ms). Optional so tests run instantly; runPoller injects a real sleep. */
  sleep?(ms: number): Promise<void>;
};

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

/** Small gap between ordinary keystrokes (e.g. an option digit and its Enter). */
export const KEY_SETTLE_MS = 120;

/**
 * Fetch one batch of deliveries, send keystrokes for mapped items,
 * and acknowledge every item (mapped or not).
 */
export async function pollOnce(deps: PollOnceDeps): Promise<void> {
  const sleep = deps.sleep ?? (() => Promise.resolve());
  const items = await deps.deliveries();
  for (const d of items) {
    const keySequences = deliveryToKeys(d);
    if (keySequences) {
      for (let i = 0; i < keySequences.length; i++) {
        const keys = keySequences[i];
        await deps.sendKeys(keys);
        // Let the keystroke register before the next one. After a literal paste
        // (`-l <text>`) Claude's paste buffer needs to settle or the following
        // Enter is absorbed as a newline; between ordinary keys (option digit →
        // Enter) a short gap lets the selection register before we confirm.
        if (i < keySequences.length - 1) {
          await sleep(keys[0] === "-l" ? pasteSettleMs(keys[1] ?? "") : KEY_SETTLE_MS);
        }
      }
    }
    await deps.markDelivered(d.id);
  }
}

/**
 * Long-running poller loop launched by `redstone-claude` in a hidden tmux window.
 *
 * 1. Wait until the session is registered (hook handler fires on first Claude activity).
 * 2. Loop indefinitely: poll → send keys → ack; back-off 5s on error.
 */
export async function runPoller(opts: {
  wrapperId: string;
  tmuxTarget: string;
  api: ApiClient;
}): Promise<void> {
  const { wrapperId, tmuxTarget, api } = opts;

  const sendKeys = async (keys: string[]): Promise<void> => {
    await execFileP("tmux", ["send-keys", "-t", tmuxTarget, ...keys]);
  };

  // Wait for the session to be registered by the hook handler
  let sessionId: string | null = null;
  while (!sessionId) {
    const s = await api.sessionByWrapper(wrapperId).catch(() => null);
    if (s) {
      sessionId = s.id;
    } else {
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Infinite poll loop with 5s error back-off
  for (;;) {
    try {
      await pollOnce({
        deliveries: () =>
          api.deliveries(wrapperId, 25_000) as Promise<Delivery[]>,
        markDelivered: (id) => api.markDelivered(id),
        sendKeys,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      });
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
    }
  }
}
