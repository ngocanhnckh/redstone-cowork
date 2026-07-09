/** Done / total / percent for a set of checklist-like items. Pure + testable.
 * `pct` is 0 when there are no items (no divide-by-zero, no empty ring). */
export function todoProgress(items: { done: boolean }[]): { done: number; total: number; pct: number } {
  const total = items.length;
  const done = items.reduce((n, t) => n + (t.done ? 1 : 0), 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}
