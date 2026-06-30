import type { LlmEndpointStore, StoredLlmEndpoint } from "../../domain/llm/llm-endpoint-store.port";

export class InMemoryLlmEndpointStore implements LlmEndpointStore {
  private rows = new Map<string, StoredLlmEndpoint>();
  async list(): Promise<StoredLlmEndpoint[]> {
    return [...this.rows.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async create(rec: StoredLlmEndpoint): Promise<StoredLlmEndpoint> {
    this.rows.set(rec.id, rec);
    return rec;
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
