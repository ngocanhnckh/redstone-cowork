import { LITERAL_CHUNK, afterKeyDelay, bracketedSettleMs, deliveryToKeys } from "@rcw/claude-core";
import type { ProbeChannel } from "./probe-channel";

// ---------------------------------------------------------------------------
// Typing into a Claude session over SSH.
//
// This is the poller's job (apps/hook-cli/src/poller.ts), moved to the desktop. The
// keystroke MAPPING is shared via @rcw/claude-core's deliveryToKeys, so both editions
// press exactly the same keys; what differs is only how they reach tmux — a long-poll
// to an installed agent there, one SSH request here.
//
// The settle delays are sent WITH the sequence and executed on the remote. Awaiting
// them here would put a network round trip in every gap, which is precisely how the
// "typed but not sent" bug (an Enter swallowed into a paste) comes back on a slow link.
// ---------------------------------------------------------------------------

export type DeliverStep = { k?: string[]; paste?: string; settleMs?: number };

export type DeliverCaps = {
  /** tmux >= 3.0: `load-buffer -` accepts bytes on stdin, so bracketed paste needs no temp file. */
  loadBufferStdin: boolean;
};

/**
 * Turn a keystroke sequence into remote steps, choosing paste vs. literal send-keys.
 *
 * Bracketed paste is the reliable path for anything long: it's atomic and explicitly
 * delimited, so the following Enter always submits. Literal `send-keys -l` has two
 * problems with long text — tmux rejects an over-long command, and Claude's TUI
 * paste-detection can swallow the Enter. On tmux older than 3.0 we can't paste from
 * stdin, so text is chunked instead, exactly as the hosted poller does.
 */
export function buildDeliverySteps(seq: string[][], caps: DeliverCaps): DeliverStep[] {
  const steps: DeliverStep[] = [];
  for (const keys of seq) {
    const isLiteral = keys[0] === "-l" && typeof keys[1] === "string";
    if (!isLiteral) {
      steps.push({ k: keys, settleMs: afterKeyDelay(keys) });
      continue;
    }
    const text = keys[1];
    if (caps.loadBufferStdin) {
      // Atomic and delimited — settle only needs a frame or two to render.
      steps.push({ paste: text, settleMs: bracketedSettleMs(text) });
      continue;
    }
    // Fallback: split so no single send-keys exceeds tmux's command length limit.
    // The chunks concatenate into the same input buffer.
    for (let i = 0; i < text.length; i += LITERAL_CHUNK) {
      const chunk = text.slice(i, i + LITERAL_CHUNK);
      steps.push({ k: ["-l", chunk], settleMs: afterKeyDelay(["-l", chunk]) });
    }
  }
  return steps;
}

/** What `deliveryToKeys` consumes — mirrors the hosted Decision shape. */
export type Delivery = {
  kind: string;
  options: { label: string }[];
  resolution: { choice: string | null; answers: Record<string, string | string[]> | null; custom: string | null } | null;
  body?: { btabs?: number; tool_input?: { questions?: { question: string; options?: { label: string }[]; multiSelect?: boolean }[] } };
};

export type DeliverResult = { ok: boolean; steps: { ok: boolean; err: string | null }[] };

/**
 * Deliver one action to a pane. Returns the per-step outcome so a caller can report
 * a partial failure at the control the user pressed, rather than claiming success.
 */
export async function deliver(
  channel: ProbeChannel,
  target: string,
  delivery: Delivery,
): Promise<DeliverResult> {
  const seq = deliveryToKeys(delivery as never);
  if (!seq || seq.length === 0) return { ok: true, steps: [] };
  const caps = channel.getInfo()?.caps;
  const steps = buildDeliverySteps(seq, { loadBufferStdin: caps?.loadBufferStdin ?? false });
  // Generous timeout: the remote is sleeping between keystrokes on our behalf.
  const budget = steps.reduce((ms, s) => ms + (s.settleMs ?? 0), 0) + 30_000;
  return channel.request<DeliverResult>("tmux.deliver", { target, steps }, budget);
}

/** Send free text and submit it — the "instruct" path. */
export function instructDelivery(text: string): Delivery {
  return { kind: "instruction", options: [], resolution: { choice: null, answers: null, custom: text } };
}

/** Abort the current turn, optionally replacing it with new instructions. */
export function interruptDelivery(text?: string): Delivery {
  return { kind: "interrupt", options: [], resolution: { choice: null, answers: null, custom: text ?? null } };
}

/** Claude Code's Shift+Tab permission-mode cycle. */
export const MODE_CYCLE = ["default", "acceptEdits", "plan", "auto"] as const;

/**
 * How many Shift+Tabs move `current` to `target`, or null when it's already there or
 * the target isn't a real mode. Mirrors DecisionsService.switchMode so both editions
 * cycle identically.
 */
export function btabsFor(current: string | null, target: string): number | null {
  const cycle = MODE_CYCLE as readonly string[];
  if (!cycle.includes(target)) return null;
  const from = current && cycle.includes(current) ? current : "default";
  const n = (cycle.indexOf(target) - cycle.indexOf(from) + cycle.length) % cycle.length;
  return n === 0 ? null : n;
}

export function modeDelivery(btabs: number): Delivery {
  return { kind: "mode", options: [], resolution: null, body: { btabs } };
}
