/**
 * Chrome-style tab discarding for the workspace browser.
 *
 * Every mounted browser tab is a full Chromium guest (its own compositor and GPU
 * tile budget); keeping dozens alive exhausts tile memory
 * (`tile_manager.cc: tile memory limits exceeded`). So we drop the <webview> of
 * tabs the user hasn't looked at for a while, keeping only the tab entry — it
 * reloads from its last known URL when clicked again, exactly like Chrome.
 */

/** How long a tab must stay continuously hidden before its guest is discarded. */
export const DISCARD_GRACE_MS = 5 * 60 * 1000;
/** Hard LRU cap on live (non-discarded) discardable tabs in one MultiBrowser. */
export const MAX_LIVE_TABS = 6;

export type DiscardTab = { id: number; temp?: boolean };

export type DiscardInput = {
  tabs: DiscardTab[];
  /** The tab currently selected in this MultiBrowser's tab strip. */
  activeId: number;
  /** Whether this MultiBrowser's layer is the one actually on screen. */
  visible: boolean;
  /** Per-tab timestamp of the last moment it was live (ms epoch). */
  lastLiveAt: Record<number, number>;
  now: number;
  graceMs?: number;
  maxLive?: number;
};

/**
 * Which tab ids should have their <webview> unmounted right now.
 *
 * Never discards:
 *  - incognito (`temp`) tabs — their partition is non-persistent, so discarding
 *    would destroy the isolated login inside it permanently. They are also
 *    excluded from the LRU accounting (never candidates, never counted).
 *  - the active tab of a visible browser (the one the user is looking at).
 */
export function tabsToDiscard(input: DiscardInput): number[] {
  const { tabs, activeId, visible, lastLiveAt, now } = input;
  const graceMs = input.graceMs ?? DISCARD_GRACE_MS;
  const maxLive = input.maxLive ?? MAX_LIVE_TABS;

  const isLive = (t: DiscardTab) => visible && t.id === activeId;
  // Incognito tabs are invisible to this whole policy.
  const candidates = tabs.filter((t) => !t.temp && !isLive(t));

  const discarded = new Set<number>();
  for (const t of candidates) {
    const since = lastLiveAt[t.id] ?? now;
    if (now - since >= graceMs) discarded.add(t.id);
  }

  // LRU cap: among the still-mounted discardable tabs (plus the live one, which
  // always counts and always survives), keep only the `maxLive` most recently
  // visible ones.
  const mounted = tabs.filter((t) => !t.temp && !discarded.has(t.id));
  if (mounted.length > maxLive) {
    const ranked = [...mounted].sort((a, b) => {
      if (isLive(a)) return -1;
      if (isLive(b)) return 1;
      return (lastLiveAt[b.id] ?? 0) - (lastLiveAt[a.id] ?? 0);
    });
    for (const t of ranked.slice(maxLive)) discarded.add(t.id);
  }

  return [...discarded];
}
