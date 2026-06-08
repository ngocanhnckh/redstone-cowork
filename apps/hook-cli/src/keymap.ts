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

  // AskUserQuestion answer. Claude renders the questions sequentially, one panel
  // at a time, and the keyboard protocol differs by question type (verified
  // against the Claude Code TUI source):
  //
  //   single-select: pressing an option's 1-based digit SELECTS it AND
  //     auto-advances to the next question. (No Enter — an Enter here would
  //     confirm the *next* question's default option.)
  //   multiSelect: a digit TOGGLES that option without moving focus. To advance
  //     you must walk focus down past every list row — the K options plus an
  //     appended hidden "Other" row, so K+1 Downs — onto the Submit/Next button,
  //     then press Enter to activate it.
  //   final submit: once the last question is answered, a review screen appears
  //     with "Submit answers" pre-focused, so a single trailing Enter submits.
  //
  // Digits only address rows 1..K (row K+1 is "Other", K+2 is "Chat about
  // this"), and only single ASCII digits work, so any chosen option beyond
  // position 9 is unreachable. Bail to null on anything we can't drive cleanly
  // rather than half-drive the form and wedge the terminal.
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
      const K = options.length;

      // Split chosen labels into preset options (addressable by digit) and any
      // free-text answer that isn't one of the options — that one is driven via
      // the appended "Other" input row (rendered last, at list index K).
      const presetIdx: number[] = [];
      const customs: string[] = [];
      for (const label of labels) {
        const idx = options.findIndex((o) => o.label === label);
        if (idx >= 0) presetIdx.push(idx);
        else customs.push(label);
      }
      if (presetIdx.some((i) => i + 1 > 9)) return null; // not digit-addressable
      if (customs.length > 1) return null; // only one Other field per question
      const custom = customs[0];

      if (!q.multiSelect) {
        if (custom !== undefined) {
          // focus the Other input (Down past the K options), type, commit+advance
          for (let i = 0; i < K; i++) keys.push(["Down"]);
          keys.push(["-l", custom]);
          keys.push(["Enter"]);
        } else {
          keys.push([String(presetIdx[0] + 1)]); // digit selects and auto-advances
        }
      } else {
        // toggle each preset option (focus stays on the first row)
        for (const idx of presetIdx) keys.push([String(idx + 1)]);
        if (custom !== undefined) {
          for (let i = 0; i < K; i++) keys.push(["Down"]); // focus the Other row
          keys.push(["-l", custom]); // type the custom text
          keys.push(["Enter"]); // check the Other box (includes the text)
          keys.push(["Down"]); // Other row -> Submit button
          keys.push(["Enter"]); // activate Submit -> advance
        } else {
          // walk past every list row (options + Other) onto Submit, then activate
          for (let i = 0; i < K + 1; i++) keys.push(["Down"]);
          keys.push(["Enter"]);
        }
      }
    }
    keys.push(["Enter"]); // review screen: "Submit answers" is pre-focused
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
