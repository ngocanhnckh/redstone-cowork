// ⚠️ The ONLY module that knows Claude Code's terminal keystroke mappings.
// Verified live in Task 10R — adjust HERE if the real dialogs differ.

type Option = { label: string };
type Question = { question: string; options?: Option[]; multiSelect?: boolean };
type Resolution = {
  choice: string | null;
  answers: Record<string, string | string[]> | null;
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

  // AskUserQuestion answer: Claude renders each question as a sequential panel.
  // Per question, press the 1-based digit of every chosen option (one for a
  // single-select question, several for a multiSelect one), then Enter to
  // confirm that question and advance to the next. For one single-select
  // question this reduces to [digit, Enter] — the confirmed single-question
  // path. Bail to null on any incomplete/unmatched answer so we never
  // half-drive the form and leave the terminal wedged.
  if (d.kind === "question" && r.answers) {
    const questions = d.body?.tool_input?.questions ?? [];
    if (questions.length === 0) return null;
    const keys: string[][] = [];
    for (const q of questions) {
      const answer = r.answers[q.question];
      if (answer === undefined) return null; // unanswered question
      const labels = Array.isArray(answer) ? answer : [answer];
      if (labels.length === 0) return null; // multiSelect with nothing picked
      const options = q.options ?? [];
      for (const label of labels) {
        const idx = options.findIndex((o) => o.label === label);
        if (idx < 0) return null; // answer with no matching option
        keys.push([String(idx + 1)]); // digit toggles/selects this option
      }
      keys.push(["Enter"]); // confirm this question and advance
    }
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
