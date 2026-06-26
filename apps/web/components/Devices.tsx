"use client";
import { useCallback, useEffect, useState } from "react";

type Device = {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

type MintedDevice = Device & { token: string };

export function Devices() {
  const [label, setLabel] = useState("my-server");
  const [minted, setMinted] = useState<MintedDevice | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/proxy/devices");
      if (r.ok) setDevices(await r.json());
    } catch {
      /* keep last good */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const generate = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    setError("");
    setMinted(null);
    try {
      const r = await fetch("/api/proxy/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!r.ok) {
        const msg = await r.text();
        setError(`Failed to mint device (${r.status}). ${msg.slice(0, 160)}`);
      } else {
        const data: MintedDevice = await r.json();
        setMinted(data);
        await refresh();
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await fetch(`/api/proxy/devices/${id}`, { method: "DELETE" });
      if (minted?.id === id) setMinted(null);
      await refresh();
    } catch {
      /* ignore */
    }
  };

  const oneLiner =
    minted?.token
      ? `curl -fsSL ${window.location.origin}/install.sh | bash -s -- --server ${window.location.origin} --token ${minted.token}`
      : "";

  const copy = async () => {
    if (!oneLiner) return;
    try {
      await navigator.clipboard.writeText(oneLiner);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const input: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #2a3550",
    background: "#0e1424",
    color: "inherit",
    fontSize: 13,
  };

  return (
    <section style={{ marginTop: 36 }}>
      <h2 style={{ fontSize: 16, opacity: 0.8 }}>
        Devices {devices.length > 0 && <span style={{ fontSize: 13, opacity: 0.6 }}>· {devices.length}</span>}
      </h2>

      {/* Generate form */}
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <input
          placeholder="device label…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          style={{ ...input, flex: 1, minWidth: 180 }}
        />
        <button
          onClick={generate}
          disabled={busy}
          style={{
            ...input,
            background: busy ? "#2a3550" : "#3b6ef6",
            color: "white",
            cursor: busy ? "not-allowed" : "pointer",
            border: 0,
            padding: "8px 16px",
          }}
        >
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: "#ff8585", marginTop: 6 }}>{error}</p>}

      {/* One-time minted panel */}
      {minted && minted.token && (
        <div
          style={{
            marginTop: 14,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #3b5f2a",
            background: "#0f1e10",
          }}
        >
          <p style={{ fontSize: 12, color: "#f5c542", margin: "0 0 8px" }}>
            ⚠ Copy this now — the token is shown once and can&apos;t be retrieved again.
          </p>
          <pre
            style={{
              margin: "0 0 8px",
              padding: "10px 12px",
              borderRadius: 6,
              background: "#0a1208",
              border: "1px solid #2a4520",
              fontSize: 12,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              color: "#a8d890",
            }}
          >
            <code>{oneLiner}</code>
          </pre>
          <button
            onClick={copy}
            style={{
              ...input,
              cursor: "pointer",
              padding: "5px 14px",
              background: copied ? "#1f4020" : "#1a2e18",
              borderColor: "#3b5f2a",
              color: copied ? "#3ddc84" : "#a8d890",
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}

      {/* Device list */}
      {devices.map((d) => (
        <div
          key={d.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 0",
            borderBottom: "1px solid #1b2440",
          }}
        >
          <strong style={{ minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.label}
          </strong>
          <span style={{ fontSize: 11, opacity: 0.5, flex: 1 }}>
            last seen: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}
          </span>
          <span style={{ fontSize: 11, opacity: 0.4, whiteSpace: "nowrap" }}>
            created {new Date(d.createdAt).toLocaleString()}
          </span>
          <button
            onClick={() => revoke(d.id)}
            style={{ ...input, cursor: "pointer", padding: "5px 10px", borderColor: "#5a2330", color: "#ff9b9b" }}
          >
            Revoke
          </button>
        </div>
      ))}

      {devices.length === 0 && (
        <p style={{ opacity: 0.4, fontSize: 13, marginTop: 8 }}>No enrolled devices.</p>
      )}
    </section>
  );
}
