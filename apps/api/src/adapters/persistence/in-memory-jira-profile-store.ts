import type { JiraProfileRecord, JiraProfileStore } from "../../domain/jira/jira-profile.port";

export class InMemoryJiraProfileStore implements JiraProfileStore {
  private readonly byName = new Map<string, JiraProfileRecord>();

  async list(): Promise<JiraProfileRecord[]> {
    return [...this.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string): Promise<JiraProfileRecord | null> {
    return this.byName.get(name) ?? null;
  }

  async upsert(rec: JiraProfileRecord): Promise<JiraProfileRecord> {
    this.byName.set(rec.name, rec);
    return rec;
  }

  async remove(name: string): Promise<void> {
    this.byName.delete(name);
  }
}
