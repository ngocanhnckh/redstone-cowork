import { describe, it, expect } from "vitest";
import { todoProgress } from "./todoStats";

describe("todoProgress", () => {
  it("returns zeros for an empty list (no divide-by-zero)", () => {
    expect(todoProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it("counts done vs total and rounds the percent", () => {
    expect(todoProgress([{ done: true }, { done: false }, { done: true }])).toEqual({ done: 2, total: 3, pct: 67 });
  });

  it("is 100 when everything is done", () => {
    expect(todoProgress([{ done: true }, { done: true }])).toEqual({ done: 2, total: 2, pct: 100 });
  });

  it("is 0 when nothing is done", () => {
    expect(todoProgress([{ done: false }, { done: false }])).toEqual({ done: 0, total: 2, pct: 0 });
  });
});
