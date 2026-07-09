import { describe, it, expect } from "vitest";
import { consumeFinishedPending, type PendingSend } from "./store";

const send = (text: string, ts = 1): PendingSend => ({ text, baseUsers: 0, ts });

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
