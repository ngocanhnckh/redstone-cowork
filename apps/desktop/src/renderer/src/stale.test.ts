import { describe, it, expect } from "vitest";
import { computeStaleWorking } from "./store";
import type { SessionView } from "./types";

const STUCK = 3 * 60 * 1000;
// Minimal SessionView stub — only the fields computeStaleWorking reads.
const sv = (id: string, working: boolean, tlen: number): SessionView =>
  ({ id, working, transcript: Array.from({ length: tlen }, () => ({ role: "assistant" as const, text: "x" })) } as unknown as SessionView);

describe("computeStaleWorking", () => {
  it("does not mark a session stale until it's been working with no new output past the window", () => {
    const id = "a1";
    expect(computeStaleWorking([[sv(id, true, 5)]], 0)[id]).toBeUndefined(); // timer starts
    expect(computeStaleWorking([[sv(id, true, 5)]], STUCK - 1)[id]).toBeUndefined(); // still within window
    expect(computeStaleWorking([[sv(id, true, 5)]], STUCK + 1)[id]).toBe(true); // stuck: no new output
  });

  it("resets the timer when the transcript grows (real work keeps producing output)", () => {
    const id = "a2";
    computeStaleWorking([[sv(id, true, 5)]], 0);
    // New output arrives just before the window elapses → timer resets.
    computeStaleWorking([[sv(id, true, 6)]], STUCK - 10);
    // Now even past the original window it isn't stale (only ~10ms since new output).
    expect(computeStaleWorking([[sv(id, true, 6)]], STUCK + 10)[id]).toBeUndefined();
  });

  it("never marks an idle (working=false) session stale, and clears its timer", () => {
    const id = "a3";
    computeStaleWorking([[sv(id, true, 5)]], 0);
    expect(computeStaleWorking([[sv(id, false, 5)]], STUCK + 1)[id]).toBeUndefined();
    // After going idle then working again, the timer restarts fresh.
    computeStaleWorking([[sv(id, true, 5)]], STUCK + 2);
    expect(computeStaleWorking([[sv(id, true, 5)]], STUCK + 3)[id]).toBeUndefined();
  });
});
