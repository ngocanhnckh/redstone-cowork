import { describe, it, expect } from "vitest";
import { consumeFinishedPending, consumeAnsweredPending, type PendingSend } from "./store";
import type { SessionView } from "./types";

const send = (text: string, ts = 1, answerAtSend: string | null = null): PendingSend => ({ text, baseUsers: 0, ts, answerAtSend });

// Minimal SessionView for the answered-pending tests.
const sess = (id: string, over: Partial<SessionView> = {}): SessionView =>
  ({ id, machine: "m", cwd: "/p", gitBranch: null, wrapperId: null, working: false, latestAnswer: null, transcript: [], ...over } as unknown as SessionView);

describe("consumeFinishedPending", () => {
  it("retires the oldest send when a session's turn ends (working true→false)", () => {
    const pending = { s1: [send("first"), send("second")] };
    const next = consumeFinishedPending(pending, { s1: true }, { s1: false });
    expect(next.s1.map((p) => p.text)).toEqual(["second"]);
  });

  it("drops the session entry when its last pending send is retired", () => {
    const pending = { s1: [send("only")] };
    const next = consumeFinishedPending(pending, { s1: true }, { s1: false });
    expect(next.s1).toBeUndefined();
  });

  it("keeps sends while the session is still working", () => {
    const pending = { s1: [send("busy")] };
    const next = consumeFinishedPending(pending, { s1: true }, { s1: true });
    expect(next.s1.map((p) => p.text)).toEqual(["busy"]);
  });

  it("keeps sends with no prior working=true edge (idle, never started)", () => {
    const pending = { s1: [send("queued")] };
    const next = consumeFinishedPending(pending, { s1: false }, { s1: false });
    expect(next.s1.map((p) => p.text)).toEqual(["queued"]);
  });

  it("retires only one send per transition, in order, across turns", () => {
    let pending: Record<string, PendingSend[]> = { s1: [send("t1"), send("t2")] };
    // First turn ends → t1 retired.
    pending = consumeFinishedPending(pending, { s1: true }, { s1: false });
    expect(pending.s1.map((p) => p.text)).toEqual(["t2"]);
    // Second turn: working goes true again, then ends → t2 retired.
    pending = consumeFinishedPending(pending, { s1: false }, { s1: true });
    expect(pending.s1.map((p) => p.text)).toEqual(["t2"]);
    pending = consumeFinishedPending(pending, { s1: true }, { s1: false });
    expect(pending.s1).toBeUndefined();
  });
});

describe("consumeAnsweredPending", () => {
  it("retires the oldest send when idle AND the assistant prose advanced (no working edge needed)", () => {
    // Sent while the last answer was "old"; the session is now idle with a NEW answer.
    const pending = { s1: [send("q", 1, "old reply")] };
    const sessions = [sess("s1", { working: false, latestAnswer: "new reply after processing" })];
    const next = consumeAnsweredPending(pending, sessions, []);
    expect(next.s1).toBeUndefined();
  });

  it("keeps the send while the session is still working", () => {
    const pending = { s1: [send("q", 1, "old")] };
    const sessions = [sess("s1", { working: true, latestAnswer: "new" })];
    expect(consumeAnsweredPending(pending, sessions, []).s1.map((p) => p.text)).toEqual(["q"]);
  });

  it("keeps the send when idle but the answer hasn't changed yet (not processed)", () => {
    const pending = { s1: [send("q", 1, "same")] };
    const sessions = [sess("s1", { working: false, latestAnswer: "same" })];
    expect(consumeAnsweredPending(pending, sessions, []).s1.map((p) => p.text)).toEqual(["q"]);
  });

  it("retires one per pass (oldest first) when several were queued", () => {
    const pending = { s1: [send("first", 1, "old"), send("second", 2, "old")] };
    const sessions = [sess("s1", { working: false, latestAnswer: "new" })];
    expect(consumeAnsweredPending(pending, sessions, []).s1.map((p) => p.text)).toEqual(["second"]);
  });
});
