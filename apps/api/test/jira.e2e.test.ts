import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { JiraService } from "../src/application/jira.service";
import { JiraClient, mapCat } from "../src/adapters/jira/jira-client";
import { InMemoryJiraProfileStore } from "../src/adapters/persistence/in-memory-jira-profile-store";
import { InMemorySessionStore } from "../src/adapters/persistence/in-memory-session-store";
import { CredentialCipher } from "../src/infrastructure/credential-cipher";
import type { AgentSession } from "@rcw/shared";

const TOKEN = "jira-token";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

/** Build a fetch stub that answers a small route table by URL substring. */
function fakeFetch(routes: Array<{ match: string; status?: number; body: unknown }>): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? (route ? 200 : 404);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route?.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

describe("Jira integration (e2e, in-memory, no network)", () => {
  let app: INestApplication;
  const srv = () => app.getHttpServer();

  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    // Stub Jira HTTP so profile validation on upsert doesn't hit the network.
    app.get(JiraService).fetchImpl = fakeFetch([
      { match: "/rest/api/2/myself", body: { displayName: "Ada Lovelace" } },
    ]);
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists no profiles initially", async () => {
    const res = await auth(request(srv()).get("/jira/profiles")).expect(200);
    expect(res.body).toEqual([]);
  });

  it("rejects unauthenticated requests with 401", async () => {
    await request(srv()).get("/jira/profiles").expect(401);
  });

  it("upserts a profile (validates creds) and never leaks the pat", async () => {
    const res = await auth(request(srv()).put("/jira/profiles/main"))
      .send({ baseUrl: "https://jira.example.com", pat: "super-secret-pat" })
      .expect(200);
    expect(res.body).toEqual({ name: "main", baseUrl: "https://jira.example.com", account: "Ada Lovelace" });

    const list = await auth(request(srv()).get("/jira/profiles")).expect(200);
    expect(list.body).toContainEqual({ name: "main", baseUrl: "https://jira.example.com", account: "Ada Lovelace" });
    expect(JSON.stringify(list.body)).not.toContain("super-secret-pat");
  });

  it("rejects an invalid profile name with 400", async () => {
    await auth(request(srv()).put("/jira/profiles/bad%20name"))
      .send({ baseUrl: "https://jira.example.com", pat: "x" })
      .expect(400);
  });

  it("rejects a malformed upsert body with 400", async () => {
    await auth(request(srv()).put("/jira/profiles/ok")).send({ baseUrl: "not-a-url", pat: "x" }).expect(400);
  });

  it("validates a stored profile", async () => {
    const res = await auth(request(srv()).get("/jira/profiles/main/validate")).expect(200);
    expect(res.body).toEqual({ ok: true, account: "Ada Lovelace" });
  });

  it("sets, gets, and clears a session binding (no network)", async () => {
    // Attach a session first so it exists.
    await auth(request(srv()).post("/sessions"))
      .send({ id: "s-jira", machine: "m1", cwd: "/repo" })
      .expect(201);

    const binding = { profile: "main", projectKey: "RCW", boardId: 7 };
    const put = await auth(request(srv()).put("/sessions/s-jira/jira")).send(binding).expect(200);
    expect(put.body).toEqual(binding);

    const get = await auth(request(srv()).get("/sessions/s-jira/jira")).expect(200);
    expect(get.body).toEqual(binding);

    await auth(request(srv()).delete("/sessions/s-jira/jira")).expect(200);
    const after = await auth(request(srv()).get("/sessions/s-jira/jira")).expect(200);
    expect(after.body).toEqual({}); // null binding → empty body
  });

  it("returns [] issues when a session has no binding", async () => {
    await auth(request(srv()).post("/sessions"))
      .send({ id: "s-nobinding", machine: "m1", cwd: "/repo" })
      .expect(201);
    const res = await auth(request(srv()).get("/sessions/s-nobinding/jira/issues")).expect(200);
    expect(res.body).toEqual([]);
  });

  it("deletes a profile", async () => {
    await auth(request(srv()).delete("/jira/profiles/main")).expect(200);
    const list = await auth(request(srv()).get("/jira/profiles")).expect(200);
    expect(list.body).toEqual([]);
  });
});

describe("JiraClient (unit)", () => {
  it("mapCat maps Jira statusCategory keys to UI buckets", () => {
    expect(mapCat("new")).toBe("todo");
    expect(mapCat("indeterminate")).toBe("inprogress");
    expect(mapCat("done")).toBe("done");
    expect(mapCat(undefined)).toBe("todo");
    expect(mapCat("weird")).toBe("todo");
  });

  it("sprintIssues maps issues and builds browse urls", async () => {
    const fetchImpl = fakeFetch([
      {
        match: "/rest/api/2/search",
        body: {
          issues: [
            {
              key: "RCW-1",
              fields: {
                summary: "Do the thing",
                status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
                assignee: { displayName: "Ada" },
              },
            },
          ],
        },
      },
    ]);
    const client = new JiraClient("https://jira.example.com/", "pat", fetchImpl);
    const issues = await client.sprintIssues("RCW");
    expect(issues).toEqual([
      {
        key: "RCW-1",
        summary: "Do the thing",
        status: "In Progress",
        statusCategory: "inprogress",
        assignee: "Ada",
        url: "https://jira.example.com/browse/RCW-1",
      },
    ]);
  });

  it("sprintIssues falls back to the non-sprint JQL when the first search 400s", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      seen.push(url);
      // First (sprint) query 400s; second (fallback) succeeds.
      if (seen.length === 1) return { ok: false, status: 400, json: async () => ({}) } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          issues: [
            { key: "RCW-9", fields: { summary: "Core issue", status: { name: "To Do", statusCategory: { key: "new" } }, assignee: null } },
          ],
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const client = new JiraClient("https://jira.example.com", "pat", fetchImpl);
    const issues = await client.sprintIssues("RCW");
    expect(seen).toHaveLength(2);
    expect(decodeURIComponent(seen[0])).toContain("openSprints()");
    expect(decodeURIComponent(seen[1])).toContain("statusCategory != Done");
    expect(issues[0]).toMatchObject({ key: "RCW-9", statusCategory: "todo", assignee: null });
  });

  it("issueDetail returns rendered description + comments", async () => {
    const fetchImpl = fakeFetch([
      {
        match: "/rest/api/2/issue/RCW-1",
        body: {
          key: "RCW-1",
          fields: { summary: "Thing", status: { name: "Done", statusCategory: { key: "done" } }, assignee: { displayName: "Ada" } },
          renderedFields: {
            description: "<p>desc</p>",
            comment: { comments: [{ author: { displayName: "Bob" }, created: "2026-01-01", body: "<p>hi</p>" }] },
          },
        },
      },
    ]);
    const client = new JiraClient("https://jira.example.com", "pat", fetchImpl);
    const detail = await client.issueDetail("RCW-1");
    expect(detail).toEqual({
      key: "RCW-1",
      summary: "Thing",
      status: "Done",
      statusCategory: "done",
      assignee: "Ada",
      url: "https://jira.example.com/browse/RCW-1",
      descriptionHtml: "<p>desc</p>",
      comments: [{ author: "Bob", created: "2026-01-01", bodyHtml: "<p>hi</p>" }],
    });
  });
});

describe("JiraService (unit, fake deps)", () => {
  const makeService = () => {
    const store = new InMemoryJiraProfileStore();
    const sessions = new InMemorySessionStore();
    const svc = new JiraService(store, new CredentialCipher(undefined), sessions);
    svc.fetchImpl = fakeFetch([{ match: "/rest/api/2/myself", body: { displayName: "Grace" } }]);
    return { svc, store, sessions };
  };

  it("upsert stores an encrypted-or-plain pat and returns the account", async () => {
    const { svc, store } = makeService();
    const summary = await svc.upsert("p1", { baseUrl: "https://j.example", pat: "secret" });
    expect(summary).toEqual({ name: "p1", baseUrl: "https://j.example", account: "Grace" });
    const rec = await store.get("p1");
    expect(rec?.patEncrypted).toBe("plain:secret"); // cipher unconfigured → plain fallback
  });

  it("upsert throws BadRequest when Jira auth fails", async () => {
    const { svc } = makeService();
    svc.fetchImpl = fakeFetch([{ match: "/rest/api/2/myself", status: 401, body: {} }]);
    await expect(svc.upsert("p2", { baseUrl: "https://j.example", pat: "bad" })).rejects.toThrow(/Jira auth failed/);
  });
});
