// ⚠️ The ONLY module that knows Claude Code's terminal keystroke mappings.
// Verified live in Task 10R — adjust HERE if the real dialogs differ.

type Option = { label: string };
type Question = { question: string; options?: Option[] };
type Resolution = {
  choice: string | null;
  answers: Record<string, string> | null;
  custom: string | null;
} | null;

type Delivery = {
  kind: string;
  options: Option[];
  resolution: Resolution;
  body?: { btabs?: number; tool_input?: { questions?: Question[] } };
};

/**
 * Map a resolved delivery to an array of tmux send-keys argument arrays.
 * Each inner array is passed as the arguments after `tmux send-keys -t <target>`.
 *
 * Returns null when no keystroke mapping is applicable (caller should ack and skip).
 */
export function deliveryToKeys(d: Delivery): string[][] | null {
  // mode: inject N Shift+Tab presses to cycle Claude Code's permission mode.
  // Handled before the resolution guard because mode deliveries carry no resolution.
  if (d.kind === "mode") {
    const n = d.body?.btabs ?? 0;
    if (n > 0) return Array.from({ length: n }, () => ["BTab"]);
    return null;
  }

  const r = d.resolution;
  if (!r) return null;
  if (r.choice === "__local__") return null;

  // instruction: type the text literally then press Enter
  if (d.kind === "instruction" && r.custom) {
    return [["-l", r.custom], ["Enter"]];
  }

  // multi-question AskUserQuestion answer: Claude renders each question as a
  // sequential panel. Pressing the chosen option's 1-based digit selects it AND
  // advances to the next question; a single final Enter submits the completed
  // form. (For one question this reduces to [digit, Enter] — the confirmed
  // single-question path.) Drive every question, then submit once.
  if (d.kind === "question" && r.answers) {
    const questions = d.body?.tool_input?.questions ?? [];
    if (questions.length === 0) return null;
    const keys: string[][] = [];
    for (const q of questions) {
      const answer = r.answers[q.question];
      if (answer === undefined) return null; // incomplete — never half-drive the form
      const idx = (q.options ?? []).findIndex((o) => o.label === answer);
      if (idx < 0) return null; // free-text answer with no matching option — skip
      keys.push([String(idx + 1)]);
    }
    keys.push(["Enter"]);
    return keys;
  }

  // permission or question: highlight the option by its 1-based digit, then
  // Enter to confirm. Claude's question dialog selects on the digit but needs
  // Enter to submit; for prompts that auto-act on the digit the trailing Enter
  // is a harmless no-op (Claude ignores Enter on empty input).
  if ((d.kind === "permission" || d.kind === "question") && r.choice) {
    const idx = d.options.findIndex((o) => o.label === r.choice);
    if (idx >= 0) return [[String(idx + 1)], ["Enter"]];
  }

  // unmapped (e.g. free-text answer to a question dialog, no matching option) — ack + skip
  return null;
}
