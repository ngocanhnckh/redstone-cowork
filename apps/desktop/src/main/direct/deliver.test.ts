import { describe, it, expect } from "vitest";
import { deliveryToKeys, LITERAL_CHUNK } from "@rcw/claude-core";
import { buildDeliverySteps, btabsFor, instructDelivery, interruptDelivery, modeDelivery, MODE_CYCLE } from "./deliver";

const modern = { loadBufferStdin: true };
const legacy = { loadBufferStdin: false };

describe("buildDeliverySteps", () => {
  it("prefers bracketed paste for literal text on tmux >= 3.0", () => {
    const steps = buildDeliverySteps([["-l", "fix the failing test"], ["Enter"]], modern);
    expect(steps[0].paste).toBe("fix the failing test");
    expect(steps[0].k).toBeUndefined();
    expect(steps[1].k).toEqual(["Enter"]);
    // Bracketed paste is atomic and delimited, so the Enter can't be absorbed — the
    // settle only needs a frame or two, unlike the length-scaled send-keys guess.
    expect(steps[0].settleMs!).toBeLessThan(500);
  });

  it("chunks literal text on older tmux, since load-buffer can't read stdin", () => {
    const long = "x".repeat(LITERAL_CHUNK * 2 + 50);
    const steps = buildDeliverySteps([["-l", long], ["Enter"]], legacy);
    const chunks = steps.filter((s) => s.k?.[0] === "-l");
    expect(chunks).toHaveLength(3);
    // tmux rejects an over-long command, so no single chunk may exceed the limit.
    for (const c of chunks) expect(c.k![1].length).toBeLessThanOrEqual(LITERAL_CHUNK);
    // The chunks must reassemble exactly — a dropped character is a corrupted prompt.
    expect(chunks.map((c) => c.k![1]).join("")).toBe(long);
    expect(steps[steps.length - 1].k).toEqual(["Enter"]);
  });

  it("carries a settle after every step, executed remotely", () => {
    // The delays are sent WITH the sequence so the remote sleeps between keystrokes.
    // Awaiting them locally would add a round trip to each gap and make the timing
    // depend on link latency — which is how the "typed but not sent" bug returns.
    const steps = buildDeliverySteps([["Escape"], ["-l", "hi"], ["Enter"]], modern);
    expect(steps.every((s) => typeof s.settleMs === "number")).toBe(true);
    // An interrupt needs longer than an ordinary keypress: aborting a turn takes time,
    // and a replacement instruction typed too early lands mid-teardown and is lost.
    expect(steps[0].settleMs!).toBeGreaterThan(steps[2].settleMs!);
  });

  it("passes non-literal keys through untouched", () => {
    const steps = buildDeliverySteps([["BTab"], ["BTab"], ["Down"], ["Enter"]], modern);
    expect(steps.map((s) => s.k)).toEqual([["BTab"], ["BTab"], ["Down"], ["Enter"]]);
    expect(steps.every((s) => s.paste === undefined)).toBe(true);
  });

  it("produces nothing for an empty sequence", () => {
    expect(buildDeliverySteps([], modern)).toEqual([]);
  });
});

describe("delivery builders round-trip through the shared keymap", () => {
  it("instruct types the text then submits", () => {
    const seq = deliveryToKeys(instructDelivery("run the tests") as never)!;
    expect(seq).toEqual([["-l", "run the tests"], ["Enter"]]);
  });

  it("a bare interrupt is a single Escape", () => {
    expect(deliveryToKeys(interruptDelivery() as never)).toEqual([["Escape"]]);
  });

  it("an interrupt with replacement text aborts, then types", () => {
    expect(deliveryToKeys(interruptDelivery("do this instead") as never))
      .toEqual([["Escape"], ["-l", "do this instead"], ["Enter"]]);
  });

  it("a mode switch is N Shift+Tabs", () => {
    expect(deliveryToKeys(modeDelivery(2) as never)).toEqual([["BTab"], ["BTab"]]);
  });
});

describe("btabsFor", () => {
  it("counts forward around Claude's permission-mode cycle", () => {
    expect(MODE_CYCLE).toEqual(["default", "acceptEdits", "plan", "auto"]);
    expect(btabsFor("default", "acceptEdits")).toBe(1);
    expect(btabsFor("default", "plan")).toBe(2);
    expect(btabsFor("default", "auto")).toBe(3);
    // The cycle wraps — there is no Shift+Tab backwards.
    expect(btabsFor("auto", "default")).toBe(1);
    expect(btabsFor("plan", "acceptEdits")).toBe(3);
  });

  it("returns null when already in the target mode, so nothing is typed", () => {
    expect(btabsFor("plan", "plan")).toBeNull();
    expect(btabsFor(null, "default")).toBeNull();
  });

  it("treats an unknown current mode as default", () => {
    expect(btabsFor("bypassPermissions", "plan")).toBe(2);
    expect(btabsFor(null, "plan")).toBe(2);
  });

  it("refuses a mode that isn't in the cycle", () => {
    expect(btabsFor("default", "nonsense")).toBeNull();
  });
});
