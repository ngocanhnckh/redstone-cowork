// ⚠️ The ONLY module that knows Claude Code's terminal keystroke mappings.
// Verified live in Task 10R — adjust HERE if the real dialogs differ.

type Option = { label: string };
type Resolution = {
  choice: string | null;
  answers: Record<string, string> | null;
  custom: string | null;
} | null;

type Delivery = {
  kind: string;
  options: Option[];
  resolution: Resolution;
};

/**
 * Map a resolved delivery to an array of tmux send-keys argument arrays.
 * Each inner array is passed as the arguments after `tmux send-keys -t <target>`.
 *
 * Returns null when no keystroke mapping is applicable (caller should ack and skip).
 */
export function deliveryToKeys(d: Delivery): string[][] | null {
  const r = d.resolution;
  if (!r) return null;
  if (r.choice === "__local__") return null;

  // instruction: type the text literally then press Enter
  if (d.kind === "instruction" && r.custom) {
    return [["-l", r.custom], ["Enter"]];
  }

  // permission or question: send the 1-based digit of the chosen option
  if ((d.kind === "permission" || d.kind === "question") && r.choice) {
    const idx = d.options.findIndex((o) => o.label === r.choice);
    if (idx >= 0) return [[String(idx + 1)]];
  }

  // unmapped (e.g. free-text answer to a question dialog, no matching option) — ack + skip
  return null;
}
