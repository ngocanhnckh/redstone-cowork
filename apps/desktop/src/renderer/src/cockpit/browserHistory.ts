// Frequently-accessed link history for the workspace browser, persisted in
// localStorage and shared across all sessions/tabs. Drives the address-bar
// typeahead suggestions and the new-tab page's "frequent" list.

const KEY = "rcw.browser.history.v1";
const MAX = 300; // cap the store so it can't grow unbounded

export type HistEntry = { url: string; title?: string; count: number; last: number };

function load(): HistEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? (raw as HistEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: HistEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

// Skip URLs that shouldn't be remembered as destinations: blanks, local dev
// previews (port-driven, session-specific), and non-web schemes.
function isRememberable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const h = new URL(url).hostname;
    if (h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  } catch {
    return false;
  }
  return true;
}

/** Record a visit — bumps the URL's frequency and recency (title optional). */
export function recordVisit(url: string, title?: string): void {
  if (!isRememberable(url)) return;
  const entries = load();
  const i = entries.findIndex((e) => e.url === url);
  const now = Date.now();
  if (i >= 0) {
    entries[i].count += 1;
    entries[i].last = now;
    if (title) entries[i].title = title;
  } else {
    entries.push({ url, title, count: 1, last: now });
  }
  save(entries);
}

/** Attach/refresh a title for an already-recorded URL WITHOUT bumping its count. */
export function updateTitle(url: string, title: string): void {
  if (!title || !isRememberable(url)) return;
  const entries = load();
  const i = entries.findIndex((e) => e.url === url);
  if (i >= 0 && entries[i].title !== title) {
    entries[i].title = title;
    save(entries);
  }
}

// Rank by frequency first, then recency — the sites you go to most, most recently.
function rank(a: HistEntry, b: HistEntry): number {
  return b.count - a.count || b.last - a.last;
}

/**
 * Suggestions for the address bar. With a query, returns entries whose URL or
 * title contains it (case-insensitive); without one, the top frequent sites.
 */
export function suggestions(query: string, limit = 6): HistEntry[] {
  const q = query.trim().toLowerCase();
  const entries = load();
  const matched = q
    ? entries.filter((e) => e.url.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q))
    : entries;
  return matched.sort(rank).slice(0, limit);
}
