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
import { jiraToolsFor } from "../src/adapters/agent/jira.tools";
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

  it("transitions() maps Jira's workflow transitions to {id,name,to} (custom statuses included)", async () => {
    const fetchImpl = fakeFetch([
      {
        match: "/rest/api/2/issue/RCW-1/transitions",
        body: {
          transitions: [
            { id: "11", name: "Start Progress", to: { name: "In Progress" } },
            { id: "42", name: "Ship It", to: { name: "Ready for QA" } }, // a project-custom status
          ],
        },
      },
    ]);
    const client = new JiraClient("https://jira.example.com", "pat", fetchImpl);
    expect(await client.transitions("RCW-1")).toEqual([
      { id: "11", name: "Start Progress", to: "In Progress" },
      { id: "42", name: "Ship It", to: "Ready for QA" },
    ]);
  });

  it("transition() POSTs the chosen transition id", async () => {
    let captured: { method?: string; body?: unknown } = {};
    const fetchImpl = (async (input: unknown, init?: { method?: string; body?: string }) => {
      captured = { method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined };
      return { ok: true, status: 204, json: async () => ({}), text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    const client = new JiraClient("https://jira.example.com", "pat", fetchImpl);
    await client.transition("RCW-1", "42");
    expect(captured.method).toBe("POST");
    expect(captured.body).toEqual({ transition: { id: "42" } });
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

const bareSession = (id: string): AgentSession => ({
  id, machine: "m1", cwd: "/repo", gitBranch: "main",
  attachedAt: new Date(), lastSeenAt: new Date(),
  wrapperId: "w1", permissionMode: "default", autoModeEnabled: false,
  latestAnswer: null, summary: null, todos: [], transcript: [], working: false, pinned: false, snoozedUntil: null,
});

describe("JiraService write-through (unit, fake deps)", () => {
  /** A service with profile "main" stored and a session "s1" bound to project RCW. */
  const makeBound = async (fetchImpl: typeof fetch) => {
    const store = new InMemoryJiraProfileStore();
    const sessions = new InMemorySessionStore();
    await store.upsert({ name: "main", baseUrl: "https://j.example", patEncrypted: "plain:pat", createdAt: new Date() });
    await sessions.upsert(bareSession("s1"));
    const svc = new JiraService(store, new CredentialCipher(undefined), sessions);
    svc.fetchImpl = fetchImpl;
    await svc.setBinding("s1", { profile: "main", projectKey: "RCW", boardId: null });
    return { svc, sessions };
  };

  it("createSessionIssue POSTs the right fields, assigns to the DC user, returns a JiraIssue", async () => {
    let sentBody: any = null;
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/api/2/myself")) {
        return { ok: true, status: 200, json: async () => ({ name: "me", displayName: "Me" }) } as Response;
      }
      if (url.includes("/rest/api/2/issue") && init?.method === "POST") {
        sentBody = JSON.parse(String(init.body));
        return { ok: true, status: 201, json: async () => ({ key: "RCW-9" }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const { svc } = await makeBound(fetchImpl);
    const issue = await svc.createSessionIssue("s1", "Ship it", "the description");
    expect(sentBody.fields.project.key).toBe("RCW");
    expect(sentBody.fields.summary).toBe("Ship it");
    expect(sentBody.fields.issuetype.name).toBe("Task");
    expect(sentBody.fields.description).toBe("the description");
    expect(sentBody.fields.assignee.name).toBe("me");
    expect(issue).toEqual({
      key: "RCW-9",
      summary: "Ship it",
      status: "To Do",
      statusCategory: "todo",
      assignee: "Me",
      url: "https://j.example/browse/RCW-9",
    });
  });

  it("commentIssue POSTs the comment body to the issue", async () => {
    let sentUrl = "";
    let sentBody: any = null;
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/comment") && init?.method === "POST") {
        sentUrl = url;
        sentBody = JSON.parse(String(init.body));
        return { ok: true, status: 201, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const { svc } = await makeBound(fetchImpl);
    await svc.commentIssue("s1", "RCW-9", "looks good");
    expect(sentUrl).toContain("/rest/api/2/issue/RCW-9/comment");
    expect(sentBody).toEqual({ body: "looks good" });
  });

  it("createSessionIssue throws BadRequest when the session has no binding", async () => {
    const store = new InMemoryJiraProfileStore();
    const sessions = new InMemorySessionStore();
    await sessions.upsert(bareSession("s-unbound"));
    const svc = new JiraService(store, new CredentialCipher(undefined), sessions);
    await expect(svc.createSessionIssue("s-unbound", "x")).rejects.toThrow(/no Jira binding/);
  });
});

describe("jiraToolsFor (agent tools)", () => {
  const boundSvc = async (fetchImpl: typeof fetch) => {
    const store = new InMemoryJiraProfileStore();
    const sessions = new InMemorySessionStore();
    await store.upsert({ name: "main", baseUrl: "https://j.example", patEncrypted: "plain:pat", createdAt: new Date() });
    await sessions.upsert(bareSession("s1"));
    const svc = new JiraService(store, new CredentialCipher(undefined), sessions);
    svc.fetchImpl = fetchImpl;
    await svc.setBinding("s1", { profile: "main", projectKey: "RCW", boardId: null });
    return svc;
  };

  it("returns [] when there's no session id", () => {
    const svc = new JiraService(new InMemoryJiraProfileStore(), new CredentialCipher(undefined), new InMemorySessionStore());
    expect(jiraToolsFor(svc, undefined)).toEqual([]);
  });

  it("exposes the four Jira tools for a session", async () => {
    const svc = await boundSvc(fakeFetch([]));
    const names = jiraToolsFor(svc, "s1").map((t) => t.name);
    expect(names).toEqual(["jira_list_sprint_issues", "jira_get_issue", "jira_create_issue", "jira_comment"]);
  });

  it("jira_create_issue returns the new key for a bound session", async () => {
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/api/2/myself")) {
        return { ok: true, status: 200, json: async () => ({ name: "me", displayName: "Me" }) } as Response;
      }
      if (url.includes("/rest/api/2/issue") && init?.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ key: "RCW-42" }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const svc = await boundSvc(fetchImpl);
    const tool = jiraToolsFor(svc, "s1").find((t) => t.name === "jira_create_issue")!;
    const out = await tool.run('{"summary":"x"}');
    expect(JSON.parse(out)).toEqual({ key: "RCW-42", url: "https://j.example/browse/RCW-42" });
  });

  it("jira_create_issue returns a 'not connected' string (never throws) for an unbound session", async () => {
    const store = new InMemoryJiraProfileStore();
    const sessions = new InMemorySessionStore();
    await sessions.upsert(bareSession("s-unbound"));
    const svc = new JiraService(store, new CredentialCipher(undefined), sessions);
    const tool = jiraToolsFor(svc, "s-unbound").find((t) => t.name === "jira_create_issue")!;
    const out = await tool.run('{"summary":"x"}');
    expect(out).toMatch(/isn't connected/i);
  });
});
