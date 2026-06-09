// Redstone Cowork service worker — Web Push delivery + tap-to-answer actions.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "Redstone Cowork", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Redstone Cowork";
  // Permission prompts can be answered straight from the notification.
  const actions =
    data.kind === "permission" && data.deliverable
      ? [
          { action: "allow", title: "Allow" },
          { action: "deny", title: "Deny" },
        ]
      : [];
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      data,
      actions,
      tag: data.decisionId || undefined, // one live notification per decision
      renotify: true,
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  // Tap-to-answer: resolve the permission decision without opening the app.
  if ((event.action === "allow" || event.action === "deny") && data.decisionId) {
    const choice = event.action === "allow" ? "Allow" : "Deny";
    event.waitUntil(
      fetch(`/api/proxy/decisions/${data.decisionId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ choice, answers: null, custom: null }),
      }).catch(() => {}),
    );
    return;
  }

  // Default: focus an open tab (navigating it to the target) or open a new one.
  const url = data.url || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          if ("navigate" in c) await c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
