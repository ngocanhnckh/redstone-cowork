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
export function nextAfterAnswer(queue: { id: string }[], answeredId: string): string | null {
  return queue.find((q) => q.id !== answeredId)?.id ?? null;
}
