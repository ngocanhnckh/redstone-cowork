import { describe, it, expect, vi } from "vitest";
import { JiraConnector } from "../src/adapters/connectors/jira.connector";
import { MattermostConnector } from "../src/adapters/connectors/mattermost.connector";

const res = (ok: boolean, body: unknown, status = ok ? 200 : 401) =>
  ({ ok, status, json: async () => body }) as Response;

describe("JiraConnector", () => {
  const cfg = { endpoint: "https://jira.example/", token: "pat", config: {} };

  it("validate hits /myself with a Bearer token", async () => {
    const fetchImpl = vi.fn(async () => res(true, { name: "me" }));
    const ok = await new JiraConnector(fetchImpl as never).validate(cfg);
    expect(ok.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://jira.example/rest/api/2/myself");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer pat" });
  });

  it("validate reports a non-OK status", async () => {
    const ok = await new JiraConnector((async () => res(false, {}, 403)) as never).validate(cfg);
    expect(ok).toEqual({ ok: false, error: "Jira responded 403" });
  });

  it("pull normalizes issues + comments and advances the cursor", async () => {
    const fetchImpl = vi.fn(async () =>
      res(true, {
        issues: [
          {
            key: "RCW-9",
            fields: {
              summary: "Do the thing", updated: "2026-06-09T10:00:00.000+0000",
              status: { name: "In Progress" }, assignee: { displayName: "Boss" },
              comment: { comments: [{ id: "1", created: "2026-06-09T09:00:00.000+0000", body: "hi", author: { displayName: "Dev" } }] },
            },
          },
        ],
      }),
    );
    const out = await new JiraConnector(fetchImpl as never).pull(cfg, {});
    expect(out.events.map((e) => e.type).sort()).toEqual(["jira.comment", "jira.issue.updated"]);
    const issue = out.events.find((e) => e.type === "jira.issue.updated")!;
    expect(issue.sourceId).toBe("RCW-9");
    expect(issue.payload.status).toBe("In Progress");
    expect(out.cursor.updatedSince).toBe("2026-06-09 10:00"); // Jira time format
  });
});

describe("MattermostConnector", () => {
  const cfg = { endpoint: "https://mm.example", token: "pat", config: {} };

  it("validate hits /users/me", async () => {
    const fetchImpl = vi.fn(async () => res(true, { id: "u1", username: "boss" }));
    expect((await new MattermostConnector(fetchImpl as never).validate(cfg)).ok).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://mm.example/api/v4/users/me");
  });

  it("pull searches each team, returns mentions newer than the cursor, advances it", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/users/me")) return res(true, { id: "u1", username: "boss" });
      if (url.endsWith("/users/me/teams")) return res(true, [{ id: "t1" }]);
      return res(true, {
        order: ["p1", "p2"],
        posts: {
          p1: { id: "p1", create_at: 1000, message: "@boss old", user_id: "u2", channel_id: "c1" },
          p2: { id: "p2", create_at: 3000, message: "@boss new", user_id: "u3", channel_id: "c1" },
        },
      });
    });
    const out = await new MattermostConnector(fetchImpl as never).pull(cfg, { lastCreateAt: 1500 });
    expect(out.events).toHaveLength(1); // p1 (1000) filtered out, p2 (3000) kept
    expect(out.events[0].sourceId).toBe("p2");
    expect(out.cursor.lastCreateAt).toBe(3000);
    // confirm it used the team-scoped search endpoint
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes("/teams/t1/posts/search"))).toBe(true);
  });
});
