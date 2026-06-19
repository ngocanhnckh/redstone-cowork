"use client";
import { useCallback, useEffect, useState } from "react";

type Connection = {
  id: string;
  kind: string;
  endpoint: string;
  label: string | null;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
};

type Event = { source: string; type: string; occurredAt: string; actor: string | null; payload: Record<string, unknown> };

const STATUS_COLOR: Record<string, string> = { connected: "#3ddc84", erroring: "#ff6b6b", disabled: "#8a93a6" };

export function Connections() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [kind, setKind] = useState("jira");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);
  const [microsoftNotice, setMicrosoftNotice] = useState<string | null>(null);

  // Surface the OAuth round-trip result (?google=… / ?microsoft=…) then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    const m = params.get("microsoft");
    if (!g && !m) return;
    if (g) setGoogleNotice(g);
    if (m) setMicrosoftNotice(m);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([fetch("/api/proxy/connections"), fetch("/api/proxy/events/recent?limit=25")]);
      if (c.ok) setConns(await c.json());
      if (e.ok) setEvents(await e.json());
    } catch {
      /* keep last good */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const add = async () => {
    if (!endpoint.trim() || !token.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/proxy/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, endpoint: endpoint.trim(), token: token.trim() }),
      });
      if (!r.ok) {
        const msg = await r.text();
        setError(`Couldn't connect (${r.status}). ${msg.slice(0, 160)}`);
      } else {
        setEndpoint("");
        setToken("");
        await refresh();
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async (id: string) => {
    await fetch(`/api/proxy/connections/${id}/sync`, { method: "POST" });
    refresh();
  };
  const disconnect = async (id: string) => {
    await fetch(`/api/proxy/connections/${id}`, { method: "DELETE" });
    refresh();
  };

  const input: React.CSSProperties = {
    padding: "8px 10px", borderRadius: 8, border: "1px solid #2a3550", background: "#0e1424", color: "inherit", fontSize: 13,
  };

  return (
    <section style={{ marginTop: 36 }}>
      <h2 style={{ fontSize: 16, opacity: 0.8 }}>Integrations {conns.length > 0 && <span style={{ fontSize: 13, opacity: 0.6 }}>· {conns.length}</span>}</h2>

      {googleNotice === "connected" && (
        <p style={{ fontSize: 12, color: "#3ddc84" }}>✓ Google connected — Gmail &amp; Calendar will start syncing.</p>
      )}
      {googleNotice === "error" && (
        <p style={{ fontSize: 12, color: "#ff8585" }}>Google connection failed — try again, and approve all requested access.</p>
      )}
      {microsoftNotice === "connected" && (
        <p style={{ fontSize: 12, color: "#3ddc84" }}>✓ Outlook connected — mail &amp; calendar will start syncing.</p>
      )}
      {microsoftNotice === "error" && (
        <p style={{ fontSize: 12, color: "#ff8585" }}>Outlook connection failed — try again, and approve all requested access.</p>
      )}

      {/* One-click OAuth — distinct from the PAT form below */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button
          onClick={() => { window.location.href = "/api/oauth/google/start"; }}
          style={{ ...input, cursor: "pointer", padding: "9px 14px", borderColor: "#3a4566", display: "flex", alignItems: "center", gap: 8 }}
        >
          <span style={{ fontWeight: 600 }}>Connect Google</span>
          <span style={{ opacity: 0.6 }}>— Gmail + Calendar</span>
        </button>
        <button
          onClick={() => { window.location.href = "/api/oauth/microsoft/start"; }}
          style={{ ...input, cursor: "pointer", padding: "9px 14px", borderColor: "#3a4566", display: "flex", alignItems: "center", gap: 8 }}
        >
          <span style={{ fontWeight: 600 }}>Connect Outlook</span>
          <span style={{ opacity: 0.6 }}>— mail + calendar</span>
        </button>
      </div>

      {conns.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1b2440" }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: STATUS_COLOR[c.status] ?? "#888", flexShrink: 0 }} />
          <strong style={{ textTransform: "capitalize" }}>{c.kind}</strong>
          <span style={{ opacity: 0.6, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.endpoint}</span>
          <span style={{ fontSize: 11, opacity: 0.5, whiteSpace: "nowrap" }}>
            {c.lastError ? c.lastError.slice(0, 40) : c.lastSyncAt ? `synced ${new Date(c.lastSyncAt).toLocaleTimeString()}` : "not synced"}
          </span>
          <button onClick={() => syncNow(c.id)} style={{ ...input, cursor: "pointer", padding: "5px 10px" }}>Sync</button>
          <button onClick={() => disconnect(c.id)} style={{ ...input, cursor: "pointer", padding: "5px 10px", borderColor: "#5a2330", color: "#ff9b9b" }}>Disconnect</button>
        </div>
      ))}

      {/* Add a connection */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={input}>
          <option value="jira">Jira</option>
          <option value="mattermost">Mattermost</option>
        </select>
        <input placeholder="https://endpoint…" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} style={{ ...input, flex: 1, minWidth: 180 }} />
        <input type="password" placeholder="Personal access token" value={token} onChange={(e) => setToken(e.target.value)} style={{ ...input, flex: 1, minWidth: 160 }} />
        <button onClick={add} disabled={busy} style={{ ...input, background: busy ? "#2a3550" : "#3b6ef6", color: "white", cursor: busy ? "not-allowed" : "pointer", border: 0, padding: "8px 16px" }}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: "#ff8585" }}>{error}</p>}

      {/* Recent ingested events */}
      {events.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>Recent activity</div>
          {events.map((e, i) => (
            <div key={i} style={{ fontSize: 12, opacity: 0.8, padding: "3px 0", display: "flex", gap: 8 }}>
              <code style={{ opacity: 0.6 }}>{e.type}</code>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {String((e.payload as { summary?: string; message?: string }).summary ?? (e.payload as { message?: string }).message ?? "")}
              </span>
              <span style={{ opacity: 0.4, whiteSpace: "nowrap" }}>{new Date(e.occurredAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
