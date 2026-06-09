"use client";
import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "unconfigured" | "enable" | "blocked" | "on" | "working";

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationsToggle() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        if (Notification.permission === "denied") return setState("blocked");
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setState(existing ? "on" : "enable");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setError("");
    setState("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "blocked" : "enable");

      const vapidRes = await fetch("/api/proxy/push/vapid");
      const { publicKey } = await vapidRes.json();
      if (!publicKey) {
        setError("Push isn't configured on this instance (no VAPID keys).");
        return setState("unconfigured");
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch("/api/proxy/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sub.toJSON(), label: navigator.userAgent.slice(0, 80) }),
      });
      if (!res.ok) throw new Error("register failed");
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
      setState("enable");
    }
  };

  const disable = async () => {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/proxy/push/subscriptions/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("enable");
    } catch {
      setState("on");
    }
  };

  if (state === "loading" || state === "unsupported") return null;

  const pill: React.CSSProperties = {
    padding: "5px 12px",
    borderRadius: 999,
    border: "1px solid #2a3550",
    background: "#0e1424",
    color: "inherit",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
      {state === "on" ? (
        <button onClick={disable} style={{ ...pill, borderColor: "#2f5d3a" }} title="Notifications are on">
          🔔 Notifications on · turn off
        </button>
      ) : state === "blocked" ? (
        <span style={{ ...pill, opacity: 0.6, cursor: "default" }}>
          🔕 Notifications blocked — allow them in your browser settings
        </span>
      ) : state === "unconfigured" ? (
        <span style={{ ...pill, opacity: 0.6, cursor: "default" }}>🔕 Push not configured</span>
      ) : (
        <button onClick={enable} disabled={state === "working"} style={pill}>
          {state === "working" ? "Enabling…" : "🔔 Enable phone notifications"}
        </button>
      )}
      {error && <span style={{ fontSize: 11, color: "#ff8585" }}>{error}</span>}
    </div>
  );
}
