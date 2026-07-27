// Pure detection helpers over a Jira issue's changelog + links. These operate on the
// NORMALISED shapes produced by JiraClient.scanIssues (not the raw REST payload), so they
// stay framework-free and trivially unit-testable.

export type StatusChange = { field: string; fromString: string | null; toString: string | null };
export type ChangeHistory = { id: string; created: string; author: string | null; items: StatusChange[] };
export type IssueLinkRef = { typeName: string; key: string; created: string | null };

/** Original Estimate seconds → hours (2 dp). Null/absent/≤0 → 0 (task doesn't score). */
export function estimateHours(seconds: number | null | undefined): number {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return 0;
  return Math.round((seconds / 3600) * 100) / 100;
}

/** Histories sorted oldest-first by their `created` timestamp. */
function ordered(histories: ChangeHistory[]): ChangeHistory[] {
  return [...histories].sort((a, b) => a.created.localeCompare(b.created));
}

/** The FIRST transition into a complete status — when the issue first "earned" its hours.
 *  Returns null if it never entered a complete status in the changelog. */
export function firstCompletion(
  histories: ChangeHistory[],
  completeStatuses: Set<string>,
): { at: Date; status: string; historyId: string; author: string | null } | null {
  for (const h of ordered(histories)) {
    for (const it of h.items) {
      if (it.field === "status" && it.toString && completeStatuses.has(it.toString)) {
        return { at: new Date(h.created), status: it.toString, historyId: h.id, author: h.author };
      }
    }
  }
  return null;
}

/** Every reopen: a status transition from a complete status back to a non-complete one.
 *  (Inherently occurs after a completion; multiple reopens each yield an event.) */
export function reopenEvents(
  histories: ChangeHistory[],
  completeStatuses: Set<string>,
): Array<{ at: Date; historyId: string; from: string; to: string }> {
  const out: Array<{ at: Date; historyId: string; from: string; to: string }> = [];
  for (const h of ordered(histories)) {
    for (const it of h.items) {
      if (
        it.field === "status" && it.fromString && it.toString &&
        completeStatuses.has(it.fromString) && !completeStatuses.has(it.toString)
      ) {
        out.push({ at: new Date(h.created), historyId: h.id, from: it.fromString, to: it.toString });
      }
    }
  }
  return out;
}

/** Links to issues CREATED strictly after the task's completion — the "it came back as a
 *  follow-up" signal. Any link type, any issue type (broad by design; ledger is voidable). */
export function followupLinks(
  links: IssueLinkRef[],
  completedAt: Date,
): Array<{ key: string; created: Date; typeName: string }> {
  const out: Array<{ key: string; created: Date; typeName: string }> = [];
  for (const l of links) {
    if (!l.created) continue;
    const created = new Date(l.created);
    if (created.getTime() > completedAt.getTime()) out.push({ key: l.key, created, typeName: l.typeName });
  }
  return out;
}
