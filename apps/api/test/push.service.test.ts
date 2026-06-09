import { describe, it, expect, vi } from "vitest";
import { PushService } from "../src/application/push.service";
import { EventsBus } from "../src/application/events-bus";
import { InMemoryPushSubscriptionStore } from "../src/adapters/persistence/in-memory-push-subscription-store";
import type { PushSender, PushSendResult } from "../src/domain/push/push-sender.port";
import type { Decision } from "@rcw/shared";

const sub = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: "p", auth: "a" },
});

const decision = (over: Partial<Decision> = {}): Decision =>
  ({
    id: "d1", sessionId: "s1", kind: "permission", title: "Bash: npm install",
    body: { deliverable: true }, options: [], status: "pending",
    createdAt: new Date(), resolvedAt: null, resolution: null, deliveredAt: null,
    ...over,
  }) as Decision;

const fakeSender = (result: PushSendResult = "ok"): PushSender & { sent: string[] } => {
  const sent: string[] = [];
  return {
    sent,
    publicKey: () => "PUBKEY",
    send: vi.fn(async (s) => { sent.push(s.endpoint); return result; }),
  };
};

describe("PushService", () => {
  it("register saves a subscription; vapidPublicKey comes from the sender", async () => {
    const store = new InMemoryPushSubscriptionStore();
    const svc = new PushService(store, fakeSender(), new EventsBus());
    await svc.register(sub("https://push.example/abc"));
    expect((await store.list())).toHaveLength(1);
    expect(svc.vapidPublicKey()).toBe("PUBKEY");
  });

  it("notify fans out to every subscription", async () => {
    const store = new InMemoryPushSubscriptionStore();
    await store.save(sub("https://push.example/1"));
    await store.save(sub("https://push.example/2"));
    const sender = fakeSender();
    const svc = new PushService(store, sender, new EventsBus());
    await svc.notify(decision());
    expect(sender.sent.sort()).toEqual(["https://push.example/1", "https://push.example/2"]);
  });

  it("prunes subscriptions that come back gone", async () => {
    const store = new InMemoryPushSubscriptionStore();
    await store.save(sub("https://push.example/dead"));
    const svc = new PushService(store, fakeSender("gone"), new EventsBus());
    await svc.notify(decision());
    expect(await store.list()).toHaveLength(0);
  });

  it("on decision.created bus event, pushes for question/permission/notification but not completion", async () => {
    const store = new InMemoryPushSubscriptionStore();
    await store.save(sub("https://push.example/x"));
    const sender = fakeSender();
    const bus = new EventsBus();
    const svc = new PushService(store, sender, bus);
    svc.onModuleInit();

    bus.emit({ type: "decision.created", payload: decision({ kind: "completion" }) });
    bus.emit({ type: "decision.created", payload: decision({ kind: "permission" }) });
    // allow the async notify() microtasks to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(sender.sent).toEqual(["https://push.example/x"]); // exactly one — completion skipped
  });
});
