import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { deliveryToKeys } from "./keymap";
import type { ApiClient } from "./api-client";

const execFileP = promisify(execFile);

type Delivery = Parameters<typeof deliveryToKeys>[0] & {
  id: string;
  sessionId?: string;
  body?: { btabs?: number; publicKey?: string; tool_input?: { questions?: unknown } };
};

export type SshResult = {
  ok: boolean;
  user?: string;
  address?: string | null;
  port?: number;
  error?: string;
};

/**
 * Install a desktop SSH public key into this box's ~/.ssh/authorized_keys, then
 * report how to reach the box. Runs ON the remote (the agent is already trusted
 * via the relay), so it bootstraps key auth with no password. Best-effort public
 * address via ipify; null when it can't be reached (e.g. NAT). Pure file/network
 * work, no tmux — the caller acks the delivery and posts the returned result.
 */
export async function authorizeSshKey(publicKey: string): Promise<SshResult> {
  const sshDir = join(homedir(), ".ssh");
  const keyFile = join(sshDir, "authorized_keys");
  await mkdir(sshDir, { recursive: true, mode: 0o700 });

  const line = publicKey.trim();
  let existing = "";
  try {
    existing = await readFile(keyFile, "utf8");
  } catch {
    existing = ""; // first key — file doesn't exist yet
  }
  const present = existing
    .split("\n")
    .map((l) => l.trim())
    .includes(line);
  if (!present) {
    const next = existing.length > 0 && !existing.endsWith("\n") ? existing + "\n" : existing;
    await writeFile(keyFile, next + line + "\n", "utf8");
  }
  await chmod(keyFile, 0o600);

  const user = userInfo().username;
  const port = 22;
  let address: string | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch("https://api.ipify.org", { signal: ctrl.signal });
      if (res.ok) address = (await res.text()).trim() || null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    address = null; // best-effort; the user can fill in HostName manually
  }

  return { ok: true, user, address, port };
}

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
  /** Report an ssh-authorize outcome back to the server. Optional; only needed when ssh deliveries arrive. */
  postSshResult?(sessionId: string, result: SshResult): Promise<void>;
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

/**
 * Small gap between ordinary keystrokes (e.g. an option digit and its Enter, or
 * the Down-walk + Enter that drives a multi-question AskUserQuestion form). Each
 * keystroke can trigger a panel transition (question → next question → review
 * screen) that must finish rendering before the next key lands, so keep a little
 * headroom above a bare frame.
 */
export const KEY_SETTLE_MS = 180;

/**
 * Fetch one batch of deliveries, send keystrokes for mapped items,
 * and acknowledge every item (mapped or not).
 */
export async function pollOnce(deps: PollOnceDeps): Promise<void> {
  const sleep = deps.sleep ?? (() => Promise.resolve());
  const items = await deps.deliveries();
  for (const d of items) {
    // ssh-authorize: install the desktop's public key locally and report back —
    // never typed into the TUI. Fully defensive: any failure becomes ok:false so
    // the poller loop (and the user's Claude session) is never broken.
    if (d.kind === "ssh-authorize") {
      const sessionId = d.sessionId;
      const publicKey = d.body?.publicKey;
      try {
        if (deps.postSshResult && sessionId) {
          const result = publicKey
            ? await authorizeSshKey(publicKey)
            : { ok: false as const, error: "missing publicKey" };
          await deps.postSshResult(sessionId, result);
        }
      } catch (e) {
        try {
          if (deps.postSshResult && sessionId) {
            await deps.postSshResult(sessionId, { ok: false, error: (e as Error)?.message ?? "ssh-authorize failed" });
          }
        } catch {
          // swallow — never break the session
        }
      }
      await deps.markDelivered(d.id);
      continue;
    }

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
        postSshResult: (sid, result) => api.postSshResult(sid, result),
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      });
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
    }
  }
}
