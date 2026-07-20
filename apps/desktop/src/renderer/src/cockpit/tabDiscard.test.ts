import { describe, expect, it } from "vitest";
import { DISCARD_GRACE_MS, MAX_LIVE_TABS, tabsToDiscard } from "./tabDiscard";

const NOW = 1_000_000_000;
const base = { activeId: 0, visible: true, now: NOW };

describe("tabsToDiscard", () => {
  it("keeps a tab hidden for less than the grace period", () => {
    expect(
      tabsToDiscard({
        ...base,
        tabs: [{ id: 0 }, { id: 1 }],
        lastLiveAt: { 1: NOW - (DISCARD_GRACE_MS - 1000) },
      }),
    ).toEqual([]);
  });

  it("discards a tab hidden for longer than the grace period", () => {
    expect(
      tabsToDiscard({
        ...base,
        tabs: [{ id: 0 }, { id: 1 }],
        lastLiveAt: { 1: NOW - DISCARD_GRACE_MS - 1 },
      }),
    ).toEqual([1]);
  });

  it("never discards the active tab of a visible browser, however stale", () => {
    const out = tabsToDiscard({
      ...base,
      activeId: 3,
      tabs: [{ id: 3 }],
      lastLiveAt: { 3: 0 },
    });
    expect(out).toEqual([]);
  });

  it("does discard the active tab when the browser layer is not visible", () => {
    const out = tabsToDiscard({
      ...base,
      visible: false,
      activeId: 3,
      tabs: [{ id: 3 }],
      lastLiveAt: { 3: 0 },
    });
    expect(out).toEqual([3]);
  });

  it("never discards incognito tabs, however stale or numerous", () => {
    const tabs = [{ id: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ id: i + 1, temp: true }))];
    const lastLiveAt = Object.fromEntries(tabs.map((t) => [t.id, 0]));
    expect(tabsToDiscard({ ...base, tabs, lastLiveAt })).toEqual([]);
  });

  it("excludes incognito tabs from the LRU cap accounting", () => {
    // 6 normal tabs (== cap) + 5 incognito. The incognito ones must not push the
    // normal tabs over the cap.
    const tabs = [
      ...Array.from({ length: MAX_LIVE_TABS }, (_, i) => ({ id: i })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, temp: true })),
    ];
    const lastLiveAt = Object.fromEntries(tabs.map((t, i) => [t.id, NOW - i * 1000]));
    expect(tabsToDiscard({ ...base, tabs, lastLiveAt })).toEqual([]);
  });

  it("enforces the LRU cap immediately, ignoring the grace period", () => {
    const tabs = Array.from({ length: MAX_LIVE_TABS + 3 }, (_, i) => ({ id: i }));
    // id 0 is active; the rest were live 1s..8s ago (higher id = older).
    const lastLiveAt = Object.fromEntries(tabs.map((t) => [t.id, NOW - t.id * 1000]));
    const out = tabsToDiscard({ ...base, tabs, lastLiveAt }).sort((a, b) => a - b);
    expect(out).toEqual([MAX_LIVE_TABS, MAX_LIVE_TABS + 1, MAX_LIVE_TABS + 2]);
  });

  it("keeps the active tab even when it is the least recently used", () => {
    const tabs = Array.from({ length: MAX_LIVE_TABS + 2 }, (_, i) => ({ id: i }));
    const lastLiveAt = Object.fromEntries(tabs.map((t) => [t.id, NOW - (10 - t.id) * 1000]));
    const out = tabsToDiscard({ ...base, activeId: 0, tabs, lastLiveAt });
    expect(out).not.toContain(0);
    expect(out).toHaveLength(2);
  });

  it("treats a tab with no recorded timestamp as just-seen (no instant discard)", () => {
    expect(tabsToDiscard({ ...base, tabs: [{ id: 0 }, { id: 1 }], lastLiveAt: {} })).toEqual([]);
  });
});
