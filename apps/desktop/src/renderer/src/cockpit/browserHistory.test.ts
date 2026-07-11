import { beforeEach, describe, it, expect } from "vitest";
import { recordVisit, updateTitle, suggestions } from "./browserHistory";

// Minimal in-memory localStorage shim for the node test environment.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("browserHistory", () => {
  it("does not remember localhost, IPs, or non-http links", () => {
    recordVisit("http://localhost:5173/");
    recordVisit("http://127.0.0.1:3000/");
    recordVisit("mailto:a@b.com");
    recordVisit("file:///tmp/x");
    expect(suggestions("")).toEqual([]);
  });

  it("ranks by frequency first, then recency", () => {
    recordVisit("https://a.com/");
    recordVisit("https://b.com/");
    recordVisit("https://b.com/"); // b visited twice → ranks above a
    const top = suggestions("").map((s) => s.url);
    expect(top).toEqual(["https://b.com/", "https://a.com/"]);
  });

  it("filters by query against url and title", () => {
    recordVisit("https://github.com/acme/repo");
    updateTitle("https://github.com/acme/repo", "Acme Repo · GitHub");
    recordVisit("https://gitlab.com/other");
    expect(suggestions("github").map((s) => s.url)).toEqual(["https://github.com/acme/repo"]);
    // matches on title too, not just the URL
    expect(suggestions("acme repo").map((s) => s.url)).toEqual(["https://github.com/acme/repo"]);
  });

  it("updateTitle attaches a title without bumping the visit count", () => {
    recordVisit("https://x.com/");
    updateTitle("https://x.com/", "X");
    recordVisit("https://y.com/");
    recordVisit("https://y.com/");
    // y (2 visits) still outranks x (1 visit + title, no bump)
    expect(suggestions("").map((s) => s.url)).toEqual(["https://y.com/", "https://x.com/"]);
    expect(suggestions("x")[0].title).toBe("X");
  });

  it("respects the suggestion limit", () => {
    for (let i = 0; i < 10; i++) recordVisit(`https://site${i}.com/`);
    expect(suggestions("", 3)).toHaveLength(3);
  });
});
