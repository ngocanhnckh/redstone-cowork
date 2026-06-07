import { RecordEventUseCase } from "../src/application/record-event.use-case";
import { InMemoryEventStore } from "../src/adapters/persistence/in-memory-event-store";

describe("RecordEventUseCase", () => {
  it("validates, stamps id+time, persists, returns the event", async () => {
    const store = new InMemoryEventStore();
    const useCase = new RecordEventUseCase(store);
    const event = await useCase.execute({ type: "test.ping", source: "test", payload: { n: 1 } });
    expect(event.id).toMatch(/[0-9a-f-]{36}/);
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(await store.list()).toHaveLength(1);
  });

  it("rejects invalid input", async () => {
    const useCase = new RecordEventUseCase(new InMemoryEventStore());
    await expect(useCase.execute({ type: "", source: "x" } as never)).rejects.toThrow();
  });
});
