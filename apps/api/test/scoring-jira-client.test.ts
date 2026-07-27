import { describe, it, expect } from "vitest";
import { JiraClient } from "../src/adapters/jira/jira-client";

/** A fetch stub that records the last URL and returns a canned JSON body. */
function stub(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("JiraClient.scanIssues", () => {
  it("requests changelog + scoring fields and normalises the payload", async () => {
    const body = {
      total: 1, startAt: 0,
      issues: [{
        key: "JP-1",
        fields: {
          summary: "x", timeoriginalestimate: 28800,
          assignee: { name: "cuong.vu", displayName: "Cuong Vu" },
          status: { name: "Done", statusCategory: { key: "done" } },
          resolutiondate: "2026-07-28T10:00:00.000+0700",
          created: "2026-07-20T00:00:00.000+0700",
          project: { key: "JP" },
          issuelinks: [
            { type: { name: "Blocks" }, outwardIssue: { key: "JP-2", fields: { created: "2026-07-29T00:00:00.000+0700" } } },
            { type: { name: "Relates" }, inwardIssue: { key: "JP-3", fields: { created: "2026-07-19T00:00:00.000+0700" } } },
          ],
        },
        changelog: { histories: [
          { id: 111, created: "2026-07-28T10:00:00.000+0700", author: { name: "cuong.vu" }, items: [{ field: "status", fromString: "In Progress", toString: "Done" }] },
        ] },
      }],
    };
    const { fetchImpl, calls } = stub(body);
    const client = new JiraClient("https://jira.example/", "pat", fetchImpl);
    const res = await client.scanIssues('project = "JP" ORDER BY updated ASC');

    expect(calls[0]).toContain("expand=changelog");
    expect(decodeURIComponent(calls[0])).toContain("timeoriginalestimate,assignee,status,issuelinks,resolutiondate,project,issuetype,created");
    expect(res.total).toBe(1);
    const i = res.issues[0];
    expect(i).toMatchObject({ key: "JP-1", projectKey: "JP", estimateSeconds: 28800, statusCategoryKey: "done" });
    expect(i.assignee).toEqual({ name: "cuong.vu", displayName: "Cuong Vu" });
    expect(i.issuelinks).toEqual([
      { typeName: "Blocks", key: "JP-2", created: "2026-07-29T00:00:00.000+0700" },
      { typeName: "Relates", key: "JP-3", created: "2026-07-19T00:00:00.000+0700" },
    ]);
    expect(i.histories[0]).toMatchObject({ id: "111", author: "cuong.vu" });
    expect(i.histories[0].items[0]).toEqual({ field: "status", fromString: "In Progress", toString: "Done" });
  });
});

describe("JiraClient.issueStatuses", () => {
  it("returns [] for empty input without calling fetch", async () => {
    const { fetchImpl, calls } = stub({});
    const client = new JiraClient("https://jira.example", "pat", fetchImpl);
    expect(await client.issueStatuses([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("queries `key in (...)` and maps status", async () => {
    const { fetchImpl, calls } = stub({ issues: [{ key: "JP-9", fields: { summary: "SSO", status: { name: "In Progress", statusCategory: { key: "indeterminate" } } } }] });
    const client = new JiraClient("https://jira.example", "pat", fetchImpl);
    const res = await client.issueStatuses(["JP-9"]);
    expect(decodeURIComponent(calls[0])).toContain("key in (");
    expect(res[0]).toEqual({ key: "JP-9", summary: "SSO", status: "In Progress", statusCategoryKey: "indeterminate" });
  });
});
