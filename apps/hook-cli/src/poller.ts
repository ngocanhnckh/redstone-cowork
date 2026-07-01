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
 * Best-effort public address of this box via ipify, with a ~4s timeout. Returns
 * null on any failure (e.g. NAT / offline) — the user can fill in HostName by hand.
 * Shared by the ssh-authorize branch and the startup host-info report.
 */
export async function detectPublicAddress(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch("https://api.ipify.org", { signal: ctrl.signal });
      if (res.ok) return (await res.text()).trim() || null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    // best-effort; fall through to null
  }
  return null;
}

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
  const address = await detectPublicAddress();

  return { ok: true, user, address, port };
}

/**
 * One-time, best-effort host-info report at poller startup so the desktop can
 * learn the box's reachable address WITHOUT the user clicking "Set up SSH".
 * Resolves the session from the wrapper, gathers user / public IP / port 22, and
 * posts it as an ssh-result. Fully defensive — never throws (it must never break
 * the poller or the user's Claude session).
 */
export async function reportHostInfo(
  wrapperId: string,
  deps: {
    getByWrapper(wrapperId: string): Promise<{ id: string } | null>;
    postSshResult(sessionId: string, result: SshResult): Promise<void>;
  }
): Promise<void> {
  try {
    const session = await deps.getByWrapper(wrapperId);
    if (!session?.id) return;
    const user = userInfo().username;
    const port = 22;
    const address = await detectPublicAddress();
    await deps.postSshResult(session.id, { ok: true, user, address, port });
  } catch {
    // swallow — host-info is best-effort and must never break the poller
  }
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
 * Max length of a single `tmux send-keys -l` literal. tmux rejects an
 * over-long command ("command too long"), so a large paste (e.g. a console
 * stack trace) must be split into several send-keys calls that concatenate
 * into the same input buffer.
 */
export const LITERAL_CHUNK = 480;

/**
 * Fetch one batch of deliveries, send keystrokes for mapped items,
 * and acknowledge every item (mapped or not).
 *
 * Each item is processed defensively and acked even on failure: a single
 * un-deliverable item (e.g. one that exceeds tmux limits) must NEVER wedge the
 * queue — otherwise every later message piles up behind it forever.
 */
export async function pollOnce(deps: PollOnceDeps): Promise<void> {
  const sleep = deps.sleep ?? (() => Promise.resolve());
  const items = await deps.deliveries();
  for (const d of items) {
    try {
      // ssh-authorize: install the desktop's public key locally and report back —
      // never typed into the TUI.
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
          if (deps.postSshResult && sessionId) {
            await deps.postSshResult(sessionId, { ok: false, error: (e as Error)?.message ?? "ssh-authorize failed" });
          }
        }
        continue; // ack happens in finally
      }

      const keySequences = deliveryToKeys(d);
      if (keySequences) {
        for (let i = 0; i < keySequences.length; i++) {
          const keys = keySequences[i];
          // Chunk a long literal paste so it stays under tmux's command-length limit.
          if (keys[0] === "-l" && (keys[1]?.length ?? 0) > LITERAL_CHUNK) {
            const text = keys[1] ?? "";
            for (let off = 0; off < text.length; off += LITERAL_CHUNK) {
              await deps.sendKeys(["-l", text.slice(off, off + LITERAL_CHUNK)]);
            }
          } else {
            await deps.sendKeys(keys);
          }
          // Let the keystroke register before the next one. After a literal paste
          // Claude's paste buffer needs to settle or the following Enter is absorbed
          // as a newline; between ordinary keys a short gap lets the selection register.
          if (i < keySequences.length - 1) {
            await sleep(keys[0] === "-l" ? pasteSettleMs(keys[1] ?? "") : KEY_SETTLE_MS);
          }
        }
      }
    } catch {
      // Un-deliverable item — swallow so it can't wedge the queue; we ack below.
    } finally {
      try {
        await deps.markDelivered(d.id);
      } catch {
        // best-effort ack; a failed ack just retries next poll
      }
    }
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

  // One-time, best-effort host-info report so the desktop can learn this box's
  // reachable address without the user clicking anything. Never throws.
  await reportHostInfo(wrapperId, {
    getByWrapper: (id) => api.getByWrapper(id),
    postSshResult: (sid, result) => api.postSshResult(sid, result),
  });

  // Infinite poll loop with 5s error back-off. Each iteration also heartbeats the
  // session: while the tmux session lives, the poller keeps running even when
  // Claude is blocked waiting for the user — so the server can tell a live
  // waiting session from a killed one (whose poller is gone) by staleness.
  for (;;) {
    try {
      await api.heartbeat(sessionId).catch(() => {});
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
