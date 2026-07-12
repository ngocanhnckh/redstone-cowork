import { beforeEach, describe, it, expect } from "vitest";
import { accelFromEvent, actionForAccel, bindingsWithDefaults, saveBindings, DEFAULT_BINDINGS } from "./keybindings";

const ev = (o: Partial<KeyboardEvent>) => o as unknown as KeyboardEvent;

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

describe("accelFromEvent", () => {
  it("returns null for a bare modifier press", () => {
    expect(accelFromEvent(ev({ key: "Control", ctrlKey: true }))).toBeNull();
    expect(accelFromEvent(ev({ key: "Shift", shiftKey: true }))).toBeNull();
  });
  it("serializes modifier combos in canonical order", () => {
    expect(accelFromEvent(ev({ key: "Tab", ctrlKey: true }))).toBe("Ctrl+Tab");
    expect(accelFromEvent(ev({ key: "Tab", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Tab");
    expect(accelFromEvent(ev({ key: "1", ctrlKey: true }))).toBe("Ctrl+1");
  });
  it("uppercases single letter keys and names Space", () => {
    expect(accelFromEvent(ev({ key: "j", ctrlKey: true }))).toBe("Ctrl+J");
    expect(accelFromEvent(ev({ key: " ", ctrlKey: true }))).toBe("Ctrl+Space");
  });
});

describe("actionForAccel (defaults)", () => {
  it("maps the default combos to their actions", () => {
    expect(actionForAccel(DEFAULT_BINDINGS, "Ctrl+Tab")).toBe("session.next");
    expect(actionForAccel(DEFAULT_BINDINGS, "Ctrl+Shift+Tab")).toBe("session.prev");
    expect(actionForAccel(DEFAULT_BINDINGS, "Ctrl+J")).toBe("assistant.toggle");
    expect(actionForAccel(DEFAULT_BINDINGS, "Ctrl+1")).toBe("tab.chat");
    expect(actionForAccel(DEFAULT_BINDINGS, "Ctrl+5")).toBe("tab.files");
  });
  it("returns null for an unbound combo", () => {
    expect(actionForAccel(DEFAULT_BINDINGS, "Ctrl+9")).toBeNull();
  });
});

describe("bindingsWithDefaults", () => {
  it("returns defaults when nothing is saved", () => {
    expect(bindingsWithDefaults()).toEqual(DEFAULT_BINDINGS);
  });
  it("overlays saved custom bindings on top of the defaults", () => {
    saveBindings({ ...DEFAULT_BINDINGS, "session.next": "Meta+ArrowRight" });
    const b = bindingsWithDefaults();
    expect(b["session.next"]).toBe("Meta+ArrowRight");
    expect(b["assistant.toggle"]).toBe("Ctrl+J"); // untouched → default
  });
});
