export function pickFocus(queue: { id: string }[], current: string | null): string | null {
  if (current && queue.some((q) => q.id === current)) return current;
  return queue[0]?.id ?? null;
}
export function nextAfterAnswer(queue: { id: string }[], answeredId: string): string | null {
  return queue.find((q) => q.id !== answeredId)?.id ?? null;
}
