/**
 * Pick the flow focus. Sticky: keep the current session as long as it still
 * EXISTS (in the full session list), even after it leaves the waiting queue
 * (e.g. it started working) — so the user isn't yanked away while watching Claude
 * work. Only when the current focus is gone (or unset) do we fall to the first
 * waiting session. Advancing on send is handled explicitly by the store.
 */
export function pickFocus(
  queue: { id: string }[],
  allSessions: { id: string }[],
  current: string | null
): string | null {
  if (current && allSessions.some((s) => s.id === current)) return current;
  return queue[0]?.id ?? null;
}
/** Decision kinds that mean a session is genuinely waiting for the user's answer. */
const ACTIONABLE_KINDS = new Set(["question", "permission"]);

/**
 * The next session actually waiting for the user's answer: the first queue entry
 * (queue is pre-sorted pinned → longest-waiting) that has a PENDING actionable
 * decision (question/permission) and isn't `excludeId`. Returns null when nothing
 * needs input — callers must NOT fall back to an arbitrary session, otherwise the
 * focus jumps to a session that's merely thinking or only showing a passive
 * completion/notification card (which still counts as "waiting" in the queue).
 */
export function nextWaiting(
  queue: { id: string }[],
  decisions: { sessionId: string; kind: string }[],
  excludeId?: string | null
): string | null {
  const needsInput = new Set(
    decisions.filter((d) => ACTIONABLE_KINDS.has(d.kind)).map((d) => d.sessionId)
  );
  return queue.find((q) => q.id !== excludeId && needsInput.has(q.id))?.id ?? null;
}
