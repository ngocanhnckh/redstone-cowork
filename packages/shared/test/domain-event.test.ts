import { describe, it, expect } from "vitest";
import { DomainEventSchema, NewDomainEventSchema } from "../src/events/domain-event";

describe("DomainEventSchema", () => {
  it("accepts a valid event", () => {
    const e = DomainEventSchema.parse({
      id: "9f3b8c1e-2a4d-4f6a-9c0d-1e2f3a4b5c6d",
      type: "worker.heartbeat",
      source: "worker",
      occurredAt: "2026-06-07T10:00:00Z",
      payload: { instance: "default" },
    });
    expect(e.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects empty type", () => {
    expect(() =>
      NewDomainEventSchema.parse({ type: "", source: "worker", payload: {} })
    ).toThrow();
  });

  it("defaults payload to empty object", () => {
    const e = NewDomainEventSchema.parse({ type: "t.created", source: "api" });
    expect(e.payload).toEqual({});
  });
});
