import type { ClaudeConfigRecord, ClaudeConfigStore } from "../../domain/claude-configs/claude-config.port";

export class InMemoryClaudeConfigStore implements ClaudeConfigStore {
  private readonly byName = new Map<string, ClaudeConfigRecord>();

  async get(name: string): Promise<ClaudeConfigRecord | null> {
    return this.byName.get(name) ?? null;
  }

  async list(): Promise<{ name: string }[]> {
    return [...this.byName.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
  }

  async upsert(name: string, envEncrypted: string): Promise<void> {
    this.byName.set(name, { name, envEncrypted });
  }

  async remove(name: string): Promise<void> {
    this.byName.delete(name);
  }
}
