import { describe, it, expect, vi } from "vitest";
import { MicrosoftConnector } from "../src/adapters/connectors/microsoft.connector";

const res = (ok: boolean, body: unknown, status = ok ? 200 : 401) =>
  ({ ok, status, json: async () => body }) as Response;

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const cfg = { endpoint: "https://graph.microsoft.com", token: "refresh-tok", config: {} };
const creds = { clientId: "cid", clientSecret: "secret" };

describe("MicrosoftConnector", () => {
  it("validate exchanges the refresh token for an access token", async () => {
    const fetchImpl = vi.fn(async () => res(true, { access_token: "at", expires_in: 3600 }));
    const out = await new MicrosoftConnector({ ...creds, fetchImpl: fetchImpl as never }).validate(cfg);
    expect(out.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(String((init as RequestInit).body)).toContain("grant_type=refresh_token");
    expect(String((init as RequestInit).body)).toContain("refresh_token=refresh-tok");
  });

  it("validate reports a failed token exchange", async () => {
    const out = await new MicrosoftConnector({
      ...creds,
      fetchImpl: (async () => res(false, { error: "invalid_grant" }, 400)) as never,
    }).validate(cfg);
    expect(out.ok).toBe(false);
  });

  it("pull normalizes Outlook mail + calendar events and advances the cursor", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return res(true, { access_token: "at" });
      if (url.includes("/me/messages")) {
        return res(true, {
          value: [
            {
              id: "m1",
              subject: "Quarterly numbers",
              from: { emailAddress: { name: "Boss", address: "boss@example.com" } },
              receivedDateTime: "2026-06-15T08:00:00Z",
              bodyPreview: "hello there",
              webLink: "https://outlook.office.com/mail/m1",
            },
          ],
        });
      }
      if (url.includes("/me/events")) {
        return res(true, {
          value: [
            {
              id: "e1",
              subject: "Board sync",
              start: { dateTime: "2026-06-14T09:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2026-06-14T10:00:00.0000000", timeZone: "UTC" },
              organizer: { emailAddress: { name: "Boss", address: "boss@example.com" } },
              lastModifiedDateTime: "2026-06-12T10:00:00Z",
              webLink: "https://outlook.office.com/calendar/e1",
            },
          ],
        });
      }
      return res(false, {}, 404);
    });

    const out = await new MicrosoftConnector({ ...creds, fetchImpl: fetchImpl as never }).pull(cfg, {});
    const types = out.events.map((e) => e.type).sort();
    expect(types).toEqual(["outlook.event", "outlook.message"]);

    const mail = out.events.find((e) => e.type === "outlook.message")!;
    expect(mail.source).toBe("microsoft");
    expect(mail.sourceId).toBe("m1");
    expect(mail.payload.subject).toBe("Quarterly numbers");
    expect(mail.payload.from).toBe("boss@example.com");

    const ev = out.events.find((e) => e.type === "outlook.event")!;
    expect(ev.sourceId).toBe("e1");
    expect(ev.payload.summary).toBe("Board sync");

    expect(out.cursor.mailReceivedMs).toBe(Date.parse("2026-06-15T08:00:00Z"));
    expect(out.cursor.eventsModifiedMin).toBe("2026-06-12T10:00:00Z");
  });

  it("pull skips mail at or before the cursor", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return res(true, { access_token: "at" });
      if (url.includes("/me/messages"))
        return res(true, { value: [{ id: "m1", subject: "old", receivedDateTime: "2020-01-01T00:00:00Z" }] });
      if (url.includes("/me/events")) return res(true, { value: [] });
      return res(false, {}, 404);
    });
    const since = Date.parse("2026-01-01T00:00:00Z");
    const out = await new MicrosoftConnector({ ...creds, fetchImpl: fetchImpl as never }).pull(cfg, { mailReceivedMs: since });
    expect(out.events).toHaveLength(0);
  });

  it("a failing mail pull does not kill the calendar pull", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return res(true, { access_token: "at" });
      if (url.includes("/me/messages")) return res(false, {}, 500);
      if (url.includes("/me/events"))
        return res(true, { value: [{ id: "e1", subject: "x", lastModifiedDateTime: "2026-06-12T10:00:00Z" }] });
      return res(false, {}, 404);
    });
    const out = await new MicrosoftConnector({ ...creds, fetchImpl: fetchImpl as never }).pull(cfg, {});
    expect(out.events.map((e) => e.type)).toEqual(["outlook.event"]);
  });
});
