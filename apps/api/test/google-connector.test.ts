import { describe, it, expect, vi } from "vitest";
import { GoogleConnector } from "../src/adapters/connectors/google.connector";

const res = (ok: boolean, body: unknown, status = ok ? 200 : 401) =>
  ({ ok, status, json: async () => body }) as Response;

const cfg = { endpoint: "https://www.googleapis.com", token: "refresh-tok", config: {} };
const creds = { clientId: "cid", clientSecret: "secret" };

describe("GoogleConnector", () => {
  it("validate exchanges the refresh token for an access token", async () => {
    const fetchImpl = vi.fn(async () => res(true, { access_token: "at", expires_in: 3600 }));
    const out = await new GoogleConnector({ ...creds, fetchImpl: fetchImpl as never }).validate(cfg);
    expect(out.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(String((init as RequestInit).body)).toContain("grant_type=refresh_token");
    expect(String((init as RequestInit).body)).toContain("refresh_token=refresh-tok");
  });

  it("validate reports a failed token exchange", async () => {
    const out = await new GoogleConnector({
      ...creds,
      fetchImpl: (async () => res(false, { error: "invalid_grant" }, 400)) as never,
    }).validate(cfg);
    expect(out.ok).toBe(false);
  });

  it("pull normalizes Gmail messages + Calendar events and advances the cursor", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") return res(true, { access_token: "at" });
      if (url.includes("/gmail/v1/users/me/messages/")) {
        return res(true, {
          id: "m1",
          internalDate: "1700000000000",
          snippet: "hello there",
          payload: {
            headers: [
              { name: "From", value: "Boss <boss@example.com>" },
              { name: "Subject", value: "Quarterly numbers" },
              { name: "Date", value: "Wed, 15 Nov 2023" },
            ],
          },
        });
      }
      if (url.includes("/gmail/v1/users/me/messages")) {
        return res(true, { messages: [{ id: "m1" }] });
      }
      if (url.includes("/calendar/v3/calendars/primary/events")) {
        return res(true, {
          items: [
            {
              id: "e1",
              summary: "Board sync",
              status: "confirmed",
              updated: "2026-06-12T10:00:00.000Z",
              start: { dateTime: "2026-06-14T09:00:00Z" },
              end: { dateTime: "2026-06-14T10:00:00Z" },
              organizer: { email: "boss@example.com" },
              htmlLink: "https://calendar.google.com/event?eid=e1",
            },
          ],
        });
      }
      return res(false, {}, 404);
    });

    const out = await new GoogleConnector({ ...creds, fetchImpl: fetchImpl as never }).pull(cfg, {});
    const types = out.events.map((e) => e.type).sort();
    expect(types).toEqual(["gcal.event", "gmail.message"]);

    const mail = out.events.find((e) => e.type === "gmail.message")!;
    expect(mail.sourceId).toBe("m1");
    expect(mail.payload.subject).toBe("Quarterly numbers");
    expect(mail.payload.from).toBe("Boss <boss@example.com>");

    const ev = out.events.find((e) => e.type === "gcal.event")!;
    expect(ev.sourceId).toBe("e1");
    expect(ev.payload.summary).toBe("Board sync");

    expect(out.cursor.lastInternalDate).toBe(1700000000000);
    expect(out.cursor.eventsUpdatedMin).toBe("2026-06-12T10:00:00.000Z");
  });

  it("pull skips Gmail messages at or before the cursor", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") return res(true, { access_token: "at" });
      if (url.includes("/gmail/v1/users/me/messages/"))
        return res(true, { id: "m1", internalDate: "1000", snippet: "old", payload: { headers: [] } });
      if (url.includes("/gmail/v1/users/me/messages")) return res(true, { messages: [{ id: "m1" }] });
      if (url.includes("/calendar/")) return res(true, { items: [] });
      return res(false, {}, 404);
    });
    const out = await new GoogleConnector({ ...creds, fetchImpl: fetchImpl as never }).pull(cfg, { lastInternalDate: 5000 });
    expect(out.events).toHaveLength(0);
  });

  it("a failing Gmail pull does not kill the Calendar pull", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") return res(true, { access_token: "at" });
      if (url.includes("/gmail/")) return res(false, {}, 500);
      if (url.includes("/calendar/v3/calendars/primary/events"))
        return res(true, { items: [{ id: "e1", summary: "x", updated: "2026-06-12T10:00:00.000Z" }] });
      return res(false, {}, 404);
    });
    const out = await new GoogleConnector({ ...creds, fetchImpl: fetchImpl as never }).pull(cfg, {});
    expect(out.events.map((e) => e.type)).toEqual(["gcal.event"]);
  });
});
