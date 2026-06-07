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
};

/**
 * Fetch one batch of deliveries, send keystrokes for mapped items,
 * and acknowledge every item (mapped or not).
 */
export async function pollOnce(deps: PollOnceDeps): Promise<void> {
  const items = await deps.deliveries();
  for (const d of items) {
    const keySequences = deliveryToKeys(d);
    if (keySequences) {
      for (const keys of keySequences) {
        await deps.sendKeys(keys);
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
      });
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
    }
  }
}
